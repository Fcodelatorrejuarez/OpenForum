import { useEffect, useMemo, useState } from "react";
import { seedThreads } from "./data/seedThreads";

const API_BASE = "http://localhost:4000/api";
const FALLBACK_SUBFORUM_ID = "clubdelaia-general";
const FALLBACK_SUBFORUM_NAME = "ClubDeLaIA";
const FALLBACK_SUBFORUM_SLUG = "clubdelaia";

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

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  return { response, payload };
}

function toHoursAgo(isoDate) {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return 1;
  }

  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  return Math.max(1, hours);
}

function getFallbackSubforums(postCount = 0) {
  return [
    {
      id: FALLBACK_SUBFORUM_ID,
      name: FALLBACK_SUBFORUM_NAME,
      slug: FALLBACK_SUBFORUM_SLUG,
      description: "General forum for practical AI and web development topics.",
      postCount
    }
  ];
}

function mapApiSubforumToClient(subforum) {
  return {
    id: subforum.id,
    name: subforum.name,
    slug: subforum.slug,
    description: subforum.description ?? "",
    postCount: Number.isFinite(subforum.postCount) ? Number(subforum.postCount) : 0
  };
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
    comments: post.comments ?? 0,
    subforumId: post.subforumId ?? FALLBACK_SUBFORUM_ID,
    subforumName: post.subforumName ?? FALLBACK_SUBFORUM_NAME,
    subforumSlug: post.subforumSlug ?? FALLBACK_SUBFORUM_SLUG
  };
}

function mapSeedThreadToThread(thread) {
  return {
    ...thread,
    subforumId: thread.subforumId ?? FALLBACK_SUBFORUM_ID,
    subforumName: thread.subforumName ?? FALLBACK_SUBFORUM_NAME,
    subforumSlug: thread.subforumSlug ?? FALLBACK_SUBFORUM_SLUG
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

function filterThreads(items, query, category, subforumId) {
  const q = query.trim().toLowerCase();
  return items.filter((thread) => {
    if (category !== "all" && thread.category !== category) {
      return false;
    }
    if (subforumId !== "all" && thread.subforumId !== subforumId) {
      return false;
    }
    if (!q) {
      return true;
    }

    const text = [
      thread.title,
      thread.author,
      thread.content,
      thread.category,
      thread.subforumName,
      thread.subforumSlug
    ]
      .join(" ")
      .toLowerCase();

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
  onRequireAuth,
  onSelectSubforum
}) {
  return (
    <article className="thread-card">
      <VoteColumn threadId={thread.id} baseScore={thread.score} voteState={voteState} onVote={onVote} />
      <div className="thread-main">
        <div className="thread-meta">
          <button
            type="button"
            className="community-link"
            onClick={() => onSelectSubforum(thread.subforumId)}
            aria-label={`Open r/${thread.subforumSlug}`}
          >
            r/{thread.subforumSlug}
          </button>
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

function NewThreadModal({ open, onClose, onCreate, creating, subforums, defaultSubforumId, error }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    category: "discussion",
    subforumId: defaultSubforumId || ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm({
      title: "",
      content: "",
      category: "discussion",
      subforumId: defaultSubforumId || ""
    });
  }, [open, defaultSubforumId]);

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim() || !form.subforumId) {
      return;
    }

    const success = await onCreate({
      title: form.title,
      content: form.content,
      category: form.category,
      subforumId: form.subforumId
    });

    if (success) {
      onClose();
    }
  }

  const disabled = creating || subforums.length === 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create new thread">
      <form className="modal" onSubmit={onSubmit}>
        <h2>Create Post</h2>

        <label>
          <span>Title</span>
          <input name="title" value={form.title} onChange={onChange} placeholder="Write a descriptive post title" />
        </label>

        <label>
          <span>Subforum</span>
          <select name="subforumId" value={form.subforumId} onChange={onChange} disabled={subforums.length === 0}>
            <option value="" disabled>
              {subforums.length === 0 ? "No subforums available" : "Select a subforum"}
            </option>
            {subforums.map((subforum) => (
              <option key={subforum.id} value={subforum.id}>
                {subforum.name} (r/{subforum.slug})
              </option>
            ))}
          </select>
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

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={disabled}>
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
            placeholder={mode === "register" ? "At least 8 chars, letter and number" : "Your password"}
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

function NewSubforumModal({ open, onClose, onCreate, creating, error }) {
  const [form, setForm] = useState({
    name: "",
    description: ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({ name: "", description: "" });
  }, [open]);

  if (!open) {
    return null;
  }

  function onChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      return;
    }

    const success = await onCreate({
      name: form.name,
      description: form.description
    });

    if (success) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create new subforum">
      <form className="modal" onSubmit={onSubmit}>
        <h2>Create Subforum</h2>

        <label>
          <span>Name</span>
          <input name="name" value={form.name} onChange={onChange} placeholder="Frontend, DevOps, UX Writing..." />
        </label>

        <label>
          <span>Description</span>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            rows={3}
            placeholder="What topics belong to this subforum?"
          ></textarea>
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? "Creating..." : "Create Subforum"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [threads, setThreads] = useState([]);
  const [subforums, setSubforums] = useState([]);
  const [selectedSort, setSelectedSort] = useState("trending");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSubforumId, setSelectedSubforumId] = useState("all");
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
  const [isSubforumModalOpen, setIsSubforumModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [creatingPost, setCreatingPost] = useState(false);
  const [createPostError, setCreatePostError] = useState("");
  const [creatingSubforum, setCreatingSubforum] = useState(false);
  const [subforumError, setSubforumError] = useState("");
  const [loadingPosts, setLoadingPosts] = useState(true);

  const [currentUser, setCurrentUser] = useState(null);

  const selectedSubforum = useMemo(() => {
    return subforums.find((subforum) => subforum.id === selectedSubforumId) ?? null;
  }, [subforums, selectedSubforumId]);

  const defaultSubforumId = useMemo(() => {
    if (selectedSubforumId !== "all" && subforums.some((subforum) => subforum.id === selectedSubforumId)) {
      return selectedSubforumId;
    }
    return subforums[0]?.id ?? "";
  }, [selectedSubforumId, subforums]);

  const postCountBySubforum = useMemo(() => {
    return threads.reduce((current, thread) => {
      const previous = current[thread.subforumId] ?? 0;
      return { ...current, [thread.subforumId]: previous + 1 };
    }, {});
  }, [threads]);

  const visibleThreads = useMemo(() => {
    const source = activeTab === "liked" ? threads.filter((thread) => likedPostIds.includes(thread.id)) : threads;
    const filtered = filterThreads(source, query, selectedCategory, selectedSubforumId);
    return sortThreads(filtered, selectedSort);
  }, [activeTab, threads, likedPostIds, query, selectedCategory, selectedSubforumId, selectedSort]);

  useEffect(() => {
    localStorage.setItem("clubdelaia_liked_posts", JSON.stringify(likedPostIds));
  }, [likedPostIds]);

  useEffect(() => {
    async function loadInitialData() {
      setLoadingPosts(true);
      try {
        const [{ response: postsResponse, payload: postsPayload }, { response: subforumsResponse, payload: subforumsPayload }] =
          await Promise.all([apiFetch("/posts"), apiFetch("/subforums")]);

        if (!postsResponse.ok) {
          throw new Error(postsPayload?.error || "Could not load posts");
        }
        if (!subforumsResponse.ok) {
          throw new Error(subforumsPayload?.error || "Could not load subforums");
        }

        const mappedPosts = Array.isArray(postsPayload?.posts) ? postsPayload.posts.map(mapApiPostToThread) : [];
        const mappedSubforums = Array.isArray(subforumsPayload?.subforums)
          ? subforumsPayload.subforums.map(mapApiSubforumToClient)
          : [];

        setThreads(mappedPosts);
        setSubforums(
          mappedSubforums.length > 0
            ? mappedSubforums.sort((a, b) => a.slug.localeCompare(b.slug))
            : getFallbackSubforums(mappedPosts.length)
        );
      } catch {
        const fallbackThreads = seedThreads.map(mapSeedThreadToThread);
        setThreads(fallbackThreads);
        setSubforums(getFallbackSubforums(fallbackThreads.length));
      } finally {
        setLoadingPosts(false);
      }
    }

    loadInitialData();
  }, []);

  useEffect(() => {
    async function loadSession() {
      try {
        const { response, payload } = await apiFetch("/auth/me");
        if (!response.ok) {
          setCurrentUser(null);
          return;
        }

        setCurrentUser(payload?.user ?? null);
      } catch {
        setCurrentUser(null);
      }
    }

    loadSession();
  }, []);

  useEffect(() => {
    if (selectedSubforumId === "all") {
      return;
    }

    if (!subforums.some((subforum) => subforum.id === selectedSubforumId)) {
      setSelectedSubforumId("all");
    }
  }, [selectedSubforumId, subforums]);

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

  function onSelectSubforum(subforumId) {
    setSelectedSubforumId(subforumId);
    setActiveTab("home");
  }

  async function loadComments(postId) {
    setCommentsLoadingByPost((current) => ({ ...current, [postId]: true }));
    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`);

      if (!response.ok) {
        throw new Error(payload?.error || "Could not load comments");
      }

      setCommentsByPost((current) => ({ ...current, [postId]: payload?.comments ?? [] }));
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

    if (!currentUser) {
      requireAuth("Sign in first to comment.");
      return;
    }

    setCommentSubmittingByPost((current) => ({ ...current, [postId]: true }));

    try {
      const { response, payload } = await apiFetch(`/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: draft })
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("Session expired. Sign in again.");
          return;
        }
        throw new Error(payload?.error || "Could not create comment");
      }

      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), payload?.comment]
      }));

      setThreads((current) =>
        current.map((thread) =>
          thread.id === postId ? { ...thread, comments: payload?.comments ?? thread.comments + 1 } : thread
        )
      );

      setCommentDraftByPost((current) => ({ ...current, [postId]: "" }));

      if (payload?.user) {
        setCurrentUser(payload.user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create comment";
      setCreatePostError("");
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

    if (subforums.length === 0) {
      return;
    }

    setCreatePostError("");
    setIsPostModalOpen(true);
  }

  function openCreateSubforum() {
    if (!currentUser) {
      requireAuth("Sign in first to create subforums.");
      return;
    }

    setSubforumError("");
    setIsSubforumModalOpen(true);
  }

  async function onCreateThread(postInput) {
    if (!currentUser) {
      requireAuth("Sign in first to create posts.");
      return false;
    }

    setCreatingPost(true);
    setCreatePostError("");

    try {
      const { response, payload } = await apiFetch("/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(postInput)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("Session expired. Sign in again.");
          return false;
        }
        throw new Error(payload?.error || "Could not create post");
      }

      const mappedPost = mapApiPostToThread(payload?.post);
      setThreads((current) => [mappedPost, ...current]);
      if (payload?.user) {
        setCurrentUser(payload.user);
      }

      setSelectedSort("newest");
      setSelectedCategory("all");
      setSelectedSubforumId(mappedPost.subforumId);
      setQuery("");
      setActiveTab("home");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create post";
      setCreatePostError(message);
      return false;
    } finally {
      setCreatingPost(false);
    }
  }

  async function onCreateSubforum(input) {
    if (!currentUser) {
      requireAuth("Sign in first to create subforums.");
      return false;
    }

    setCreatingSubforum(true);
    setSubforumError("");

    try {
      const { response, payload } = await apiFetch("/subforums", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setCurrentUser(null);
          requireAuth("Session expired. Sign in again.");
          return false;
        }
        throw new Error(payload?.error || "Could not create subforum");
      }

      const mappedSubforum = mapApiSubforumToClient(payload?.subforum);
      setSubforums((current) =>
        [...current, mappedSubforum].sort((a, b) => a.slug.localeCompare(b.slug))
      );
      setSelectedSubforumId(mappedSubforum.id);
      setActiveTab("home");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create subforum";
      setSubforumError(message);
      return false;
    } finally {
      setCreatingSubforum(false);
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

      const { response, payload } = await apiFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Authentication failed");
      }

      setCurrentUser(payload?.user ?? null);
      setIsAuthModalOpen(false);
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    try {
      await apiFetch("/auth/logout", {
        method: "POST"
      });
    } catch {
      // The client state is still cleared locally.
    }

    setCurrentUser(null);
  }

  const feedTitle =
    activeTab === "liked"
      ? "Your liked posts"
      : selectedSubforum
        ? `r/${selectedSubforum.slug}`
        : "All subforums";

  const feedDescription =
    activeTab === "liked"
      ? "Posts you marked with heart."
      : selectedSubforum
        ? selectedSubforum.description || `Threads from ${selectedSubforum.name}.`
        : "Simple, practical threads for AI and front-end development.";

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
            <h1>{feedTitle}</h1>
            <p>{feedDescription}</p>
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

            <label className="subforum-filter">
              <span>Subforum</span>
              <select
                value={selectedSubforumId}
                onChange={(event) => {
                  setSelectedSubforumId(event.target.value);
                  setActiveTab("home");
                }}
              >
                <option value="all">All</option>
                {subforums.map((subforum) => (
                  <option key={subforum.id} value={subforum.id}>
                    r/{subforum.slug}
                  </option>
                ))}
              </select>
            </label>

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
                    onSelectSubforum={onSelectSubforum}
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
                <strong>{threads.length}</strong>
                <span>Posts</span>
              </div>
              <div>
                <strong>{subforums.length}</strong>
                <span>Subforums</span>
              </div>
            </div>

            <button className="btn-primary" type="button" onClick={openCreatePost}>
              Create Post
            </button>
          </section>

          <section className="panel">
            <h2>Subforums</h2>
            <div className="subforum-list">
              <button
                type="button"
                className={`subforum-btn ${selectedSubforumId === "all" ? "active" : ""}`}
                onClick={() => {
                  setSelectedSubforumId("all");
                  setActiveTab("home");
                }}
              >
                <span>All subforums</span>
                <span>{threads.length}</span>
              </button>

              {subforums.map((subforum) => (
                <button
                  key={subforum.id}
                  type="button"
                  className={`subforum-btn ${selectedSubforumId === subforum.id ? "active" : ""}`}
                  onClick={() => onSelectSubforum(subforum.id)}
                >
                  <span>r/{subforum.slug}</span>
                  <span>{postCountBySubforum[subforum.id] ?? subforum.postCount ?? 0}</span>
                </button>
              ))}
            </div>

            <button className="btn-secondary full-width-btn" type="button" onClick={openCreateSubforum}>
              Create Subforum
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
        onClose={() => {
          setIsPostModalOpen(false);
          setCreatePostError("");
        }}
        onCreate={onCreateThread}
        creating={creatingPost}
        subforums={subforums}
        defaultSubforumId={defaultSubforumId}
        error={createPostError}
      />

      <NewSubforumModal
        open={isSubforumModalOpen}
        onClose={() => {
          setIsSubforumModalOpen(false);
          setSubforumError("");
        }}
        onCreate={onCreateSubforum}
        creating={creatingSubforum}
        error={subforumError}
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
