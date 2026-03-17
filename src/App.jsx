import { useMemo, useState } from "react";
import { seedThreads } from "./data/seedThreads";

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

function ThreadCard({ thread, voteState, onVote }) {
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
          <button type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>{thread.comments} Comments</span>
          </button>
          <button type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"></path>
            </svg>
            <span>Share</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function NewThreadModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({
    title: "",
    author: "",
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

  function onSubmit(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.author.trim() || !form.content.trim()) {
      return;
    }
    onCreate({
      ...form,
      id: `t-${Date.now()}`,
      score: 1,
      comments: 0,
      ageHours: 1
    });
    setForm({ title: "", author: "", content: "", category: "discussion" });
    onClose();
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
          <span>Author</span>
          <input name="author" value={form.author} onChange={onChange} placeholder="Your username" />
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
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Post
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [threads, setThreads] = useState(seedThreads);
  const [selectedSort, setSelectedSort] = useState("trending");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [votesByThread, setVotesByThread] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);

  const visibleThreads = useMemo(() => {
    const filtered = filterThreads(threads, query, selectedCategory);
    return sortThreads(filtered, selectedSort);
  }, [threads, query, selectedCategory, selectedSort]);

  function onVote(threadId, direction) {
    setVotesByThread((current) => {
      const previous = current[threadId] ?? 0;
      const next = direction === "up" ? (previous === 1 ? 0 : 1) : previous === -1 ? 0 : -1;
      return { ...current, [threadId]: next };
    });
  }

  function onCreateThread(newThread) {
    setThreads((current) => [newThread, ...current]);
    setSelectedSort("newest");
    setSelectedCategory("all");
    setQuery("");
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
            <a href="#" className="active">
              Home
            </a>
            <a href="#">Popular</a>
            <a href="#">All</a>
          </nav>

          <div className="header-actions">
            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              Create Post
            </button>
          </div>
        </div>
      </header>

      <div className="layout">
        <main className="main-column">
          <section className="feed-head">
            <h1>r/ClubDeLaIA</h1>
            <p>Simple, practical threads for front-end development.</p>
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
            {visibleThreads.length > 0 ? (
              visibleThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  voteState={votesByThread[thread.id] ?? 0}
                  onVote={onVote}
                />
              ))
            ) : (
              <div className="empty-state">No threads match this filter and search combination.</div>
            )}
          </section>
        </main>

        <aside className="sidebar">
          <section className="panel">
            <h2>About Community</h2>
            <p>
              A place to ask front-end questions, share resources, and discuss practical UI engineering.
            </p>

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

            <button className="btn-primary" type="button" onClick={() => setIsModalOpen(true)}>
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
                <strong>Stay on topic.</strong> Keep posts relevant to front-end.
              </li>
            </ol>
          </section>
        </aside>
      </div>

      <NewThreadModal open={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={onCreateThread} />
    </div>
  );
}
