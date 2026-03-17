import { useEffect, useMemo, useState } from "react";
import { seedThreads } from "./data/seedThreads";

const API_BASE = "http://localhost:4000/api";

const sortOptions = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "top", label: "Top" }
];

const categoryOptions = [
  { id: "all", label: "All" },
  { id: "discussion", label: "Discussion" },
  { id: "resource", label: "Resource" },
  { id: "help", label: "Help" }
];

const categoryClass = {
  discussion: "tag discussion",
  resource: "tag resource",
  help: "tag help"
};

const categoryLabel = {
  discussion: "Discussion",
  resource: "Resource",
  help: "Help"
};

function toHoursAgo(isoDate) {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return 1;
  }

  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  return Math.max(1, hours);
}

function mapApiPostToThread(post) {
  return {
    id: post.id,
    category: post.category,
    score: post.score,
    ageHours: toHoursAgo(post.createdAt),
    title: post.title,
    author: post.author,
    content: post.content,
    comments: post.comments ?? 0
  };
}

function sortThreads(items, selectedSort) {
  const list = [...items];
  if (selectedSort === "newest") {
    return list.sort((a, b) => a.ageHours - b.ageHours);
  }
  if (selectedSort === "top") {
    return list.sort((a, b) => b.score - a.score);
  }
  return list.sort((a, b) => {
    const trendA = a.score * 0.7 + (24 - a.ageHours) * 0.3;
    const trendB = b.score * 0.7 + (24 - b.ageHours) * 0.3;
    return trendB - trendA;
  });
}

function filterThreads(items, query, category) {
  const q = query.trim().toLowerCase();
  return items.filter((thread) => {
    if (category !== "all" && thread.category !== category) {
      return false;
    }
    if (!q) {
      return true;
    }
    const text = [thread.title, thread.author, thread.content, thread.category].join(" ").toLowerCase();
    return text.includes(q);
  });
}

function timeAgo(hours) {
  if (hours <= 1) {
    return "1 hour ago";
  }
  if (hours < 24) {
    return `${hours} hours ago`;
  }
  const days = Math.round(hours / 24);
  return days <= 1 ? "1 day ago" : `${days} days ago`;
}

function VoteColumn({ threadId, baseScore, voteState, onVote }) {
  const score = baseScore + voteState;

  return (
    <div className="votes">
      <button
        className={`vote-btn upvote ${voteState === 1 ? "active" : ""}`}
        type="button"
        aria-label="Upvote"
        onClick={() => onVote(threadId, "up")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 19V5M5 12l7-7 7 7"></path>
        </svg>
      </button>
      <span className="score">{score}</span>
      <button
        className={`vote-btn downvote ${voteState === -1 ? "active" : ""}`}
        type="button"
        aria-label="Downvote"
        onClick={() => onVote(threadId, "down")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 5v14M19 12l-7 7-7-7"></path>
        </svg>
      </button>
    </div>
  );
}

function ThreadCard({
  thread,
  voteState,
  onVote,
  isLiked,
  onToggleLike,
  commentsOpen,
  onToggleComments,
  comments,
  commentsLoading,
  commentDraft,
  onCommentDraftChange,
  onCommentSubmit,
  commentSubmitting,
  currentUser,
  onRequireAuth
}) {
  return (
    <article className="thread-card">
      <VoteColumn threadId={thread.id} baseScore={thread.score} voteState={voteState} onVote={onVote} />
      <div className="thread-main">
        <div className="thread-meta">
          <span className="community">r/ClubDeLaIA</span>
          <span>•</span>
          <span>Posted by u/{thread.author}</span>
          <span>•</span>
          <span>{timeAgo(thread.ageHours)}</span>
          <span className={categoryClass[thread.category]}>{categoryLabel[thread.category]}</span>
        </div>
        <h2 className="thread-title">{thread.title}</h2>
        <p className="thread-snippet">{thread.content}</p>

        <div className="thread-actions">
          <button type="button" onClick={() => onToggleComments(thread.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>{thread.comments} Comments</span>
          </button>

          <button
            type="button"
            className={isLiked ? "liked-btn" : ""}
            aria-label={isLiked ? "Unlike post" : "Like post"}
            onClick={() => onToggleLike(thread.id)}
          >
            <svg viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor">
              <path d="M12 21s-6.7-4.35-9.2-8.1C.98 10.14 1.55 6.8 4.6 5.45A5.08 5.08 0 0 1 12 8.02a5.08 5.08 0 0 1 7.4-2.57c3.05 1.35 3.62 4.69 1.8 7.45C18.7 16.65 12 21 12 21z"></path>
            </svg>
            <span>{isLiked ? "Liked" : "Like"}</span>
          </button>
        </div>

        {commentsOpen ? (
          <div className="comments-panel">
            {commentsLoading ? <p className="comment-empty">Loading comments...</p> : null}

            {!commentsLoading && comments.length === 0 ? (
              <p className="comment-empty">No comments yet. Be the first to comment.</p>
            ) : null}

            {!commentsLoading && comments.length > 0 ? (
              <ul className="comments-list">
                {comments.map((comment) => (
                  <li key={comment.id} className="comment-item">
                    <p className="comment-meta">
                      <strong>u/{comment.author}</strong>
                      <span>•</span>
                      <span>{new Date(comment.createdAt).toLocaleString()}</span>
                    </p>
                    <p className="comment-content">{comment.content}</p>
                  </li>
                ))}
              </ul>
            ) : null}

            {currentUser ? (
              <form
                className="comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCommentSubmit(thread.id);
                }}
              >
                <textarea
                  value={commentDraft}
                  onChange={(event) => onCommentDraftChange(thread.id, event.target.value)}
                  rows={2}
                  placeholder="Write your comment"
                ></textarea>
                <button type="submit" className="btn-primary" disabled={commentSubmitting}>
                  {commentSubmitting ? "Sending..." : "Comment"}
                </button>
              </form>
            ) : (
              <button type="button" className="comment-login-btn" onClick={onRequireAuth}>
                Sign in to comment
              </button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function NewThreadModal({ open, onClose, onCreate, creating }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    category: "discussion"
  });

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      return;
    }

    const success = await onCreate({
      title: form.title,
      content: form.content,
      category: form.category
    });

    if (success) {
      setForm({ title: "", content: "", category: "discussion" });
      onClose();
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create new thread">
      <form className="modal" onSubmit={onSubmit}>
        <h2>Create Post</h2>

        <label>
          <span>Title</span>
          <input name="title" value={form.title} onChange={onChange} placeholder="Write a descriptive post title" />
        </label>

        <label>
          <span>Category</span>
          <select name="category" value={form.category} onChange={onChange}>
            <option value="discussion">Discussion</option>
            <option value="resource">Resource</option>
            <option value="help">Help</option>
          </select>
        </label>

        <label>
          <span>Content</span>
          <textarea
            name="content"
            value={form.content}
            onChange={onChange}
            rows={4}
            placeholder="Add your post text, links, or question details"
          ></textarea>
        </label>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? "Posting..." : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthModal({ open, mode, onClose, onSwitchMode, onSubmit, loading, error }) {
  const [form, setForm] = useState({
    username: "",
    password: ""
  });

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    await onSubmit({
      mode,
      username: form.username,
      password: form.password
    });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Authentication">
      <form className="modal" onSubmit={submit}>
        <h2>{mode === "register" ? "Create account" : "Sign in"}</h2>

        <label>
          <span>Username</span>
          <input
            name="username"
            value={form.username}
            onChange={onChange}
            placeholder="your_username"
            required
          />
        </label>

        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={onChange}
            placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
            required
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Please wait..." : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </div>

        <button type="button" className="auth-switch" onClick={onSwitchMode}>
          {mode === "register" ? "Already have an account? Sign in" : "Need an account? Register"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [threads, setThreads] = useState([]);
  const [selectedSort, setSelectedSort] = useState("trending");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [votesByThread, setVotesByThread] = useState({});

  const [activeTab, setActiveTab] = useState("home");
  const [likedPostIds, setLikedPostIds] = useState(() => {
    try {
      const raw = localStorage.getItem("clubdelaia_liked_posts");
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [commentsByPost, setCommentsByPost] = useState({});
  const [expandedCommentsByPost, setExpandedCommentsByPost] = useState({});
  const [commentDraftByPost, setCommentDraftByPost] = useState({});
  const [commentsLoadingByPost, setCommentsLoadingByPost] = useState({});
  const [commentSubmittingByPost, setCommentSubmittingByPost] = useState({});

  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [creatingPost, setCreatingPost] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(true);

  const [token, setToken] = useState(() => localStorage.getItem("clubdelaia_token") || "");
  const [currentUser, setCurrentUser] = useState(null);

  const visibleThreads = useMemo(() => {
    const source = activeTab === "liked" ? threads.filter((thread) => likedPostIds.includes(thread.id)) : threads;
    const filtered = filterThreads(source, query, selectedCategory);
    return sortThreads(filtered, selectedSort);
  }, [activeTab, threads, likedPostIds, query, selectedCategory, selectedSort]);

  useEffect(() => {
    localStorage.setItem("clubdelaia_liked_posts", JSON.stringify(likedPostIds));
  }, [likedPostIds]);

  useEffect(() => {
    async function loadPosts() {
      setLoadingPosts(true);
      try {
        const response = await fetch(`${API_BASE}/posts`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Could not load posts");
        }

        const mapped = payload.posts.map(mapApiPostToThread);
        setThreads(mapped);
      } catch {
        setThreads(seedThreads);
      } finally {
        setLoadingPosts(false);
      }
    }

    loadPosts();
  }, []);

  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      return;
    }

    async function loadSession() {
      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Session expired");
        }

        setCurrentUser(payload.user);
      } catch {
        localStorage.removeItem("clubdelaia_token");
        setToken("");
        setCurrentUser(null);
      }
    }

    loadSession();
  }, [token]);

  function saveToken(nextToken) {
    localStorage.setItem("clubdelaia_token", nextToken);
    setToken(nextToken);
  }

  function openAuthModal(mode, errorMessage = "") {
    setAuthMode(mode);
    setAuthError(errorMessage);
    setIsAuthModalOpen(true);
  }

  function requireAuth(message) {
    openAuthModal("login", message);
  }

  function onVote(threadId, direction) {
    setVotesByThread((current) => {
      const previous = current[threadId] ?? 0;
      const next = direction === "up" ? (previous === 1 ? 0 : 1) : previous === -1 ? 0 : -1;
      return { ...current, [threadId]: next };
    });
  }

  function onToggleLike(threadId) {
    setLikedPostIds((current) => {
      if (current.includes(threadId)) {
        return current.filter((id) => id !== threadId);
      }
      return [...current, threadId];
    });
  }

  async function loadComments(postId) {
    setCommentsLoadingByPost((current) => ({ ...current, [postId]: true }));
    try {
      const response = await fetch(`${API_BASE}/posts/${postId}/comments`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Could not load comments");
      }

      setCommentsByPost((current) => ({ ...current, [postId]: payload.comments }));
    } catch {
      setCommentsByPost((current) => ({ ...current, [postId]: current[postId] ?? [] }));
    } finally {
      setCommentsLoadingByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  function onToggleComments(postId) {
    setExpandedCommentsByPost((current) => {
      const willOpen = !current[postId];
      if (willOpen && !Object.prototype.hasOwnProperty.call(commentsByPost, postId)) {
        loadComments(postId);
      }
      return { ...current, [postId]: willOpen };
    });
  }

  function onCommentDraftChange(postId, value) {
    setCommentDraftByPost((current) => ({ ...current, [postId]: value }));
  }

  async function onCommentSubmit(postId) {
    const draft = (commentDraftByPost[postId] ?? "").trim();
    if (!draft) {
      return;
    }

    if (!token) {
      requireAuth("Sign in first to comment.");
      return;
    }

    setCommentSubmittingByPost((current) => ({ ...current, [postId]: true }));

    try {
      const response = await fetch(`${API_BASE}/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: draft })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not create comment");
      }

      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), payload.comment]
      }));

      setThreads((current) =>
        current.map((thread) =>
          thread.id === postId ? { ...thread, comments: payload.comments ?? thread.comments + 1 } : thread
        )
      );

      setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));

      if (payload.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create comment";
      requireAuth(message);
    } finally {
      setCommentSubmittingByPost((current) => ({ ...current, [postId]: false }));
    }
  }

  function openCreatePost() {
    if (!currentUser) {
      requireAuth("Sign in first to create posts.");
      return;
    }
    setIsPostModalOpen(true);
  }

  async function onCreateThread(postInput) {
    if (!token) {
      requireAuth("Sign in first to create posts.");
      return false;
    }

    setCreatingPost(true);

    try {
      const response = await fetch(`${API_BASE}/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(postInput)
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not create post");
      }

      setThreads((current) => [mapApiPostToThread(payload.post), ...current]);
      if (payload.user) {
        setCurrentUser(payload.user);
      }
      setSelectedSort("newest");
      setSelectedCategory("all");
      setQuery("");
      setActiveTab("home");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create post";
      requireAuth(message);
      return false;
    } finally {
      setCreatingPost(false);
    }
  }

  async function onAuthSubmit(values) {
    setAuthError("");
    setAuthLoading(true);

    try {
      const endpoint = values.mode === "register" ? "/auth/register" : "/auth/login";
      const body = {
        username: values.username,
        password: values.password
      };

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Authentication failed");
      }

      saveToken(payload.token);
      setCurrentUser(payload.user);
      setIsAuthModalOpen(false);
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("clubdelaia_token");
    setToken("");
    setCurrentUser(null);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <a href="#" className="brand">
            <span className="brand-icon" aria-hidden="true"></span>
            <span>ClubDeLaIA</span>
          </a>

          <nav className="header-links">
            <button
              type="button"
              className={`header-link-btn ${activeTab === "home" ? "active" : ""}`}
              onClick={() => setActiveTab("home")}
            >
              Home
            </button>
            <button
              type="button"
              className={`header-link-btn ${activeTab === "liked" ? "active" : ""}`}
              onClick={() => setActiveTab("liked")}
            >
              <span className="heart">❤</span>
              Liked
            </button>
          </nav>

          <div className="header-actions">
            {currentUser ? (
              <>
                <span className="username-chip">u/{currentUser.username}</span>
                <span className="username-chip">Rep: {currentUser.reputation}</span>
                <button type="button" className="btn-secondary" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => openAuthModal("login", "")}>
                Sign in
              </button>
            )}
            <button type="button" className="btn-primary" onClick={openCreatePost}>
              Create Post
            </button>
          </div>
        </div>
      </header>

      <div className="layout">
        <main className="main-column">
          <section className="feed-head">
            <h1>{activeTab === "liked" ? "Your liked posts" : "r/ClubDeLaIA"}</h1>
            <p>
              {activeTab === "liked"
                ? "Posts you marked with heart."
                : "Simple, practical threads for AI and front-end development."}
            </p>
          </section>

          <section className="toolbar" aria-label="Feed controls">
            {sortOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`filter-btn ${selectedSort === option.id ? "active" : ""}`}
                onClick={() => setSelectedSort(option.id)}
              >
                {option.label}
              </button>
            ))}

            <div className="category-group">
              {categoryOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`category-btn ${selectedCategory === option.id ? "active" : ""}`}
                  onClick={() => setSelectedCategory(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="search-wrap" aria-label="Search threads">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="7"></circle>
                <path d="m20 20-3.4-3.4"></path>
              </svg>
              <input
                className="search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
                placeholder="Search title, author, or content"
              />
            </label>
          </section>

          <section className="thread-list">
            {loadingPosts ? <div className="empty-state">Loading posts...</div> : null}

            {!loadingPosts && visibleThreads.length > 0
              ? visibleThreads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    voteState={votesByThread[thread.id] ?? 0}
                    onVote={onVote}
                    isLiked={likedPostIds.includes(thread.id)}
                    onToggleLike={onToggleLike}
                    commentsOpen={Boolean(expandedCommentsByPost[thread.id])}
                    onToggleComments={onToggleComments}
                    comments={commentsByPost[thread.id] ?? []}
                    commentsLoading={Boolean(commentsLoadingByPost[thread.id])}
                    commentDraft={commentDraftByPost[thread.id] ?? ""}
                    onCommentDraftChange={onCommentDraftChange}
                    onCommentSubmit={onCommentSubmit}
                    commentSubmitting={Boolean(commentSubmittingByPost[thread.id])}
                    currentUser={currentUser}
                    onRequireAuth={() => requireAuth("Sign in first to comment.")}
                  />
                ))
              : null}

            {!loadingPosts && visibleThreads.length === 0 ? (
              <div className="empty-state">
                {activeTab === "liked"
                  ? "No liked posts yet. Press the heart on any post."
                  : "No threads match this filter and search combination."}
              </div>
            ) : null}
          </section>
        </main>

        <aside className="sidebar">
          <section className="panel">
            <h2>About Community</h2>
            <p>A place to ask questions, share resources, and discuss practical coding and AI topics.</p>

            <div className="stats">
              <div>
                <strong>1.2k</strong>
                <span>Members</span>
              </div>
              <div>
                <strong>42</strong>
                <span>Online</span>
              </div>
            </div>

            <button className="btn-primary" type="button" onClick={openCreatePost}>
              Create Post
            </button>
          </section>

          <section className="panel">
            <h2>Flairs</h2>
            <div className="pill-group">
              <span className="pill">discussion</span>
              <span className="pill">help</span>
              <span className="pill">resource</span>
              <span className="pill">question</span>
              <span className="pill">typography</span>
              <span className="pill">a11y</span>
            </div>
          </section>

          <section className="panel">
            <h2>House Rules</h2>
            <ol className="rules">
              <li>
                <strong>Be helpful.</strong> Explain why your answer works.
              </li>
              <li>
                <strong>Add context.</strong> Share code and expected behavior.
              </li>
              <li>
                <strong>Stay on topic.</strong> Keep posts relevant to the community.
              </li>
            </ol>
          </section>
        </aside>
      </div>

      <NewThreadModal
        open={isPostModalOpen}
        onClose={() => setIsPostModalOpen(false)}
        onCreate={onCreateThread}
        creating={creatingPost}
      />

      <AuthModal
        open={isAuthModalOpen}
        mode={authMode}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthError("");
        }}
        onSwitchMode={() => {
          setAuthError("");
          setAuthMode((current) => (current === "login" ? "register" : "login"));
        }}
        onSubmit={onAuthSubmit}
        loading={authLoading}
        error={authError}
      />
    </div>
  );
}
