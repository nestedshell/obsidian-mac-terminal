/*
 * mt-pty: pseudo-terminal helper for the Mac Terminal Obsidian plugin.
 *
 * Usage: mt-pty <cols> <rows> <program> [args...]
 *
 *   fd 0  bytes typed by the user, written to the terminal
 *   fd 1  terminal output, read by the plugin
 *   fd 2  helper diagnostics (one plain-text line on failure)
 *   fd 3  optional control channel (a socket pair):
 *         in:  "W <cols> <rows>\n" resizes the terminal
 *         out: "X <code> <signal>\n" just before the helper exits: the program's
 *              exit code (or -1) and the signal that killed it (or 0)
 *
 * <program> must be an absolute path. It runs in a new session with the pty as
 * its controlling terminal, in the helper's working directory and environment,
 * and inherits no other file descriptor. The helper exits with the program's exit
 * status (128 + signal number if it was killed by a signal). When the plugin goes
 * away (fd 0 closes) or sends SIGHUP/SIGTERM/SIGINT, the program's session is
 * hung up: SIGHUP first, SIGKILL after a grace period.
 *
 * Why a separate process: Obsidian runs plugins in its renderer. A native addon
 * there can crash the whole app (node-pty does on window reload); a plain child
 * process can't. This file is the only native code of the plugin.
 */

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#include <util.h>

#define BUF_CAP 65536        /* per direction: bounded memory, backpressure beyond */
#define CTRL_CAP 64          /* longest accepted control line */
#define MAX_DIM 4096         /* columns/rows accepted */
#define HANGUP_GRACE_MS 2000 /* SIGHUP → SIGKILL */
#define DRAIN_MS 150         /* output still read after the program exits */
#define HANGUP_CLOSE_MS 300  /* SIGHUP → terminal closed */
#define CTRL_FD 3

struct buf {
	char data[BUF_CAP];
	size_t len;
};

static volatile sig_atomic_t stop_requested = 0;
static int wake_pipe[2] = {-1, -1};

static void on_signal(int sig) {
	int saved = errno;
	if (sig != SIGCHLD) stop_requested = 1;
	ssize_t ignored = write(wake_pipe[1], "x", 1);
	(void)ignored;
	errno = saved;
}

static long long now_ms(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void fail(const char *what) {
	dprintf(STDERR_FILENO, "mt-pty: %s: %s\n", what, strerror(errno));
	_exit(1);
}

static int parse_dim(const char *s) {
	char *end = NULL;
	errno = 0;
	long v = strtol(s, &end, 10);
	if (errno != 0 || end == s || *end != '\0' || v < 1 || v > MAX_DIM) return -1;
	return (int)v;
}

static int set_flags(int fd, int nonblock) {
	int fl = fcntl(fd, F_GETFL);
	if (fl == -1) return -1;
	if (nonblock && fcntl(fd, F_SETFL, fl | O_NONBLOCK) == -1) return -1;
	int fdfl = fcntl(fd, F_GETFD);
	if (fdfl == -1) return -1;
	return fcntl(fd, F_SETFD, fdfl | FD_CLOEXEC);
}

/* Closes every inherited descriptor above `keep_max`, so the program can't reach
 * anything of Obsidian's. Collects first, closes after, never closes the dir fd. */
static void close_inherited(int keep_max) {
	for (int pass = 0; pass < 8; pass++) {
		int fds[512];
		int count = 0, more = 0;
		DIR *dir = opendir("/dev/fd");
		if (!dir) {
			for (int fd = keep_max + 1; fd < 4096; fd++) close(fd);
			return;
		}
		int self = dirfd(dir);
		struct dirent *e;
		while ((e = readdir(dir)) != NULL) {
			char *end = NULL;
			long fd = strtol(e->d_name, &end, 10);
			if (end == e->d_name || *end != '\0' || fd <= keep_max || fd == self) continue;
			if (count < (int)(sizeof fds / sizeof fds[0])) fds[count++] = (int)fd;
			else more = 1;
		}
		closedir(dir);
		for (int i = 0; i < count; i++) close(fds[i]);
		if (!more) return;
	}
}

/* Reads 1–4 decimal digits at *s into a size in [1, MAX_DIM]; -1 if malformed. */
static int take_dim(const char **s) {
	int v = 0, digits = 0;
	while (**s >= '0' && **s <= '9' && digits < 5) {
		v = v * 10 + (**s - '0');
		(*s)++;
		digits++;
	}
	if (digits == 0 || digits > 4 || v < 1 || v > MAX_DIM) return -1;
	return v;
}

/* The only command: "W <cols> <rows>". Anything else is ignored. */
static void handle_control_line(int master, const char *line) {
	const char *s = line;
	if (s[0] != 'W' || s[1] != ' ') return;
	s += 2;
	int cols = take_dim(&s);
	if (cols < 0 || *s != ' ') return;
	s++;
	int rows = take_dim(&s);
	if (rows < 0 || *s != '\0') return;
	struct winsize ws = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};
	ioctl(master, TIOCSWINSZ, &ws); /* the kernel sends SIGWINCH to the foreground job */
}

/* Writes as much of `b` as the fd accepts; returns -1 on a fatal error. */
static int flush_buf(int fd, struct buf *b) {
	while (b->len > 0) {
		ssize_t n = write(fd, b->data, b->len);
		if (n > 0) {
			memmove(b->data, b->data + n, b->len - (size_t)n);
			b->len -= (size_t)n;
		} else if (n == -1 && errno == EINTR) {
			continue;
		} else if (n == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
			return 0;
		} else {
			return -1;
		}
	}
	return 0;
}

static int ctrl_fd = -1;

/* Reports how the program ended on the control channel, then exits likewise. */
static void exit_like(int status) {
	int code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
	int sig = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
	if (ctrl_fd >= 0) {
		char msg[48];
		int len = snprintf(msg, sizeof msg, "X %d %d\n", code, sig);
		if (len > 0 && (size_t)len < sizeof msg) {
			int fl = fcntl(ctrl_fd, F_GETFL);
			if (fl != -1) fcntl(ctrl_fd, F_SETFL, fl & ~O_NONBLOCK);
			ssize_t ignored = write(ctrl_fd, msg, (size_t)len);
			(void)ignored;
		}
	}
	if (code >= 0) _exit(code);
	_exit(128 + sig);
}

int main(int argc, char **argv) {
	if (argc < 4) {
		dprintf(STDERR_FILENO, "usage: mt-pty <cols> <rows> <program> [args...]\n");
		return 2;
	}
	int cols = parse_dim(argv[1]);
	int rows = parse_dim(argv[2]);
	const char *program = argv[3];
	if (cols < 0 || rows < 0) {
		dprintf(STDERR_FILENO, "mt-pty: invalid size\n");
		return 2;
	}
	if (program[0] != '/') {
		dprintf(STDERR_FILENO, "mt-pty: program must be an absolute path\n");
		return 2;
	}

	int have_ctrl = fcntl(CTRL_FD, F_GETFD) != -1;
	close_inherited(have_ctrl ? CTRL_FD : STDERR_FILENO);

	if (pipe(wake_pipe) == -1) fail("pipe");
	if (set_flags(wake_pipe[0], 1) == -1 || set_flags(wake_pipe[1], 1) == -1) fail("fcntl");

	struct sigaction sa;
	memset(&sa, 0, sizeof sa);
	sa.sa_handler = on_signal;
	sigemptyset(&sa.sa_mask);
	sigaction(SIGCHLD, &sa, NULL);
	sigaction(SIGHUP, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);
	signal(SIGPIPE, SIG_IGN);

	/* Same line discipline as Terminal.app and node-pty. Every control character
	 * starts disabled, so none is left at 0 (NUL would act as a control key). */
	struct termios term;
	memset(&term, 0, sizeof term);
	for (size_t i = 0; i < NCCS; i++) term.c_cc[i] = (cc_t)_POSIX_VDISABLE;
	term.c_iflag = ICRNL | IXON | IXANY | IMAXBEL | BRKINT | IUTF8;
	term.c_oflag = OPOST | ONLCR;
	term.c_cflag = CREAD | CS8 | HUPCL;
	term.c_lflag = ICANON | ISIG | IEXTEN | ECHO | ECHOE | ECHOK | ECHOKE | ECHOCTL;
	term.c_cc[VEOF] = 4;
	term.c_cc[VERASE] = 0x7f;
	term.c_cc[VWERASE] = 23;
	term.c_cc[VKILL] = 21;
	term.c_cc[VREPRINT] = 18;
	term.c_cc[VINTR] = 3;
	term.c_cc[VQUIT] = 0x1c;
	term.c_cc[VSUSP] = 26;
	term.c_cc[VDSUSP] = 25;
	term.c_cc[VSTATUS] = 20;
	term.c_cc[VSTART] = 17;
	term.c_cc[VSTOP] = 19;
	term.c_cc[VLNEXT] = 22;
	term.c_cc[VDISCARD] = 15;
	term.c_cc[VMIN] = 1;
	term.c_cc[VTIME] = 0;
	cfsetispeed(&term, B38400);
	cfsetospeed(&term, B38400);
	struct winsize ws = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};

	int master = -1;
	pid_t pid = forkpty(&master, NULL, &term, &ws);
	if (pid == -1) fail("forkpty");

	if (pid == 0) {
		/* Child: default signal handling, nothing inherited but the pty. */
		int sigs[] = {SIGCHLD, SIGHUP, SIGTERM, SIGINT, SIGPIPE, SIGQUIT, SIGTSTP, SIGTTIN, SIGTTOU, SIGWINCH};
		for (size_t i = 0; i < sizeof sigs / sizeof sigs[0]; i++) signal(sigs[i], SIG_DFL);
		sigset_t none;
		sigemptyset(&none);
		sigprocmask(SIG_SETMASK, &none, NULL);
		close_inherited(STDERR_FILENO);
		execv(program, &argv[3]);
		dprintf(STDERR_FILENO, "mac-terminal: cannot run %s: %s\r\n", program, strerror(errno));
		_exit(127);
	}

	if (set_flags(master, 1) == -1) fail("fcntl");
	if (set_flags(STDIN_FILENO, 1) == -1 || set_flags(STDOUT_FILENO, 1) == -1) fail("fcntl");
	if (have_ctrl && set_flags(CTRL_FD, 1) == -1) have_ctrl = 0;
	if (have_ctrl) ctrl_fd = CTRL_FD;

	static struct buf in, out;
	char ctrl[CTRL_CAP];
	size_t ctrl_len = 0;
	int ctrl_overflow = 0;

	int stdin_open = 1, stdout_open = 1, master_open = 1;
	int child_alive = 1, child_status = 0;
	long long hangup_at = -1, exited_at = -1;

	for (;;) {
		/* Reap the program. */
		while (child_alive) {
			int st;
			pid_t r = waitpid(pid, &st, WNOHANG);
			if (r == pid) {
				child_alive = 0;
				child_status = st;
				exited_at = now_ms();
			} else if (r == -1 && errno == EINTR) {
				continue;
			} else {
				break;
			}
		}

		/* The plugin closed the session or went away: hang up the program. */
		if (hangup_at < 0 && (stop_requested || !stdin_open || !stdout_open)) {
			hangup_at = now_ms();
			in.len = 0; /* nothing more is typed into a session that is ending */
			if (child_alive) {
				kill(-pid, SIGHUP);
				kill(pid, SIGHUP);
				/* A stopped shell only sees the hangup once it runs again. */
				kill(-pid, SIGCONT);
				kill(pid, SIGCONT);
			}
		}
		/* Close the terminal only once the shell had time to pass the hangup on to its
		 * jobs: if the terminal goes away first, a shell can read the error, exit as on
		 * end of input, and leave its background jobs running. */
		if (hangup_at >= 0 && master_open && (!child_alive || now_ms() - hangup_at >= HANGUP_CLOSE_MS)) {
			close(master);
			master_open = 0;
		}

		if (!child_alive) {
			if (hangup_at >= 0) exit_like(child_status);
			/* Let the last output through, then leave (background jobs get SIGHUP). */
			int drained = !master_open || now_ms() - exited_at >= DRAIN_MS;
			if (drained && (out.len == 0 || !stdout_open)) exit_like(child_status);
			if (drained && master_open) {
				close(master);
				master_open = 0;
			}
		}

		if (hangup_at >= 0 && child_alive && now_ms() - hangup_at >= HANGUP_GRACE_MS) {
			kill(-pid, SIGKILL);
			kill(pid, SIGKILL);
			int st;
			while (waitpid(pid, &st, 0) == -1 && errno == EINTR) {
			}
			exit_like(st);
		}

		struct pollfd p[5];
		int n = 0, i_wake = -1, i_in = -1, i_out = -1, i_master = -1, i_ctrl = -1;
		p[n] = (struct pollfd){.fd = wake_pipe[0], .events = POLLIN};
		i_wake = n++;
		if (stdin_open && in.len < BUF_CAP && hangup_at < 0) {
			p[n] = (struct pollfd){.fd = STDIN_FILENO, .events = POLLIN};
			i_in = n++;
		}
		if (stdout_open && out.len > 0) {
			p[n] = (struct pollfd){.fd = STDOUT_FILENO, .events = POLLOUT};
			i_out = n++;
		}
		if (master_open) {
			short ev = 0;
			if (out.len < BUF_CAP) ev |= POLLIN;
			if (in.len > 0) ev |= POLLOUT;
			p[n] = (struct pollfd){.fd = master, .events = ev};
			i_master = n++;
		}
		if (have_ctrl) {
			p[n] = (struct pollfd){.fd = CTRL_FD, .events = POLLIN};
			i_ctrl = n++;
		}

		int timeout = -1;
		if (hangup_at >= 0 && child_alive) timeout = 50;
		if (!child_alive) timeout = 20;

		int ready = poll(p, (nfds_t)n, timeout);
		if (ready == -1) {
			if (errno == EINTR) continue;
			fail("poll");
		}

		if (p[i_wake].revents & POLLIN) {
			char drain[64];
			while (read(wake_pipe[0], drain, sizeof drain) > 0) {
			}
		}

		if (i_in >= 0 && (p[i_in].revents & (POLLIN | POLLHUP | POLLERR))) {
			ssize_t r = read(STDIN_FILENO, in.data + in.len, BUF_CAP - in.len);
			if (r > 0) in.len += (size_t)r;
			else if (r == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) stdin_open = 0;
		}

		if (i_master >= 0 && master_open) {
			short re = p[i_master].revents;
			if ((re & POLLOUT) && in.len > 0 && flush_buf(master, &in) == -1) {
				in.len = 0;
			}
			if ((re & (POLLIN | POLLHUP | POLLERR)) && out.len < BUF_CAP) {
				ssize_t r = read(master, out.data + out.len, BUF_CAP - out.len);
				if (r > 0) {
					out.len += (size_t)r;
				} else if (r == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
					/* EIO: every process closed the terminal. */
					close(master);
					master_open = 0;
					in.len = 0;
				}
			}
		}

		if (out.len > 0 && stdout_open && (i_out < 0 || (p[i_out].revents & (POLLOUT | POLLERR | POLLHUP)))) {
			if (flush_buf(STDOUT_FILENO, &out) == -1) {
				stdout_open = 0;
				out.len = 0;
			}
		}

		if (i_ctrl >= 0 && (p[i_ctrl].revents & (POLLIN | POLLHUP | POLLERR))) {
			char tmp[256];
			ssize_t r = read(CTRL_FD, tmp, sizeof tmp);
			if (r == 0 || (r == -1 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)) {
				/* The plugin holds this socket for the whole session: it closed, or its
				 * process died, so hang up even if unread input keeps stdin from ending. */
				have_ctrl = 0;
				stop_requested = 1;
			}
			for (ssize_t k = 0; k < r; k++) {
				char c = tmp[k];
				if (c == '\n') {
					if (!ctrl_overflow) {
						ctrl[ctrl_len] = '\0';
						if (master_open) handle_control_line(master, ctrl);
					}
					ctrl_len = 0;
					ctrl_overflow = 0;
				} else if (ctrl_len + 1 < CTRL_CAP) {
					ctrl[ctrl_len++] = c;
				} else {
					ctrl_overflow = 1;
				}
			}
		}
	}
}
