import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Question, QType, Filters, Progress, QuizData, RawQuestion } from "./types";
import quizData from "./data/data.json";

const LS_KEY = "pldc_quiz_progress_v2";

// Convert raw JSON to processed questions
function processQuestions(raw: RawQuestion[]): Question[] {
    return raw.map((q) => {
        const base: Question = {
            id: String(q.id),
            type: q.type,
            typeLabel: q.type_description,
            prompt: q.question,
            explanation: q.explanation,
        };

        if (q.type === "fill_in_blank") {
            return { ...base, correctAnswer: q.answer };
        }

        if (q.options) {
            const correctIdx = q.options.findIndex((o) => o.is_correct);
            return {
                ...base,
                options: q.options.map((o) => o.text),
                correctIndex: correctIdx,
            };
        }

        return base;
    });
}

const QUESTIONS = processQuestions((quizData as QuizData).questions);
const META = (quizData as QuizData).meta;

// Normalize text for comparison (remove diacritics, lowercase)
function normalize(s: string) {
    return s
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Fisher-Yates shuffle with seed for consistency
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function typeLabel(t: QType | "all") {
    switch (t) {
        case "true_false": return "Đúng/Sai";
        case "multiple_choice_one_correct": return "Chọn đáp án đúng";
        case "multiple_choice_best_answer": return "Chọn đáp án đúng nhất";
        case "fill_in_blank": return "Điền khuyết";
        default: return "Tất cả";
    }
}

function loadProgress(): Progress {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) throw new Error("no data");
        const parsed = JSON.parse(raw) as Progress;
        return {
            seen: parsed.seen ?? {},
            wrong: parsed.wrong ?? {},
            correct: parsed.correct ?? {},
            starred: parsed.starred ?? {},
        };
    } catch {
        return { seen: {}, wrong: {}, correct: {}, starred: {} };
    }
}

function saveProgress(p: Progress) {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
}

export default function App() {
    const [filters, setFilters] = useState<Filters>({
        type: "all",
        mode: "random20",
        shuffle: true,
    });

    const [progress, setProgress] = useState<Progress>(() => loadProgress());

    // Session key to trigger re-shuffle only when filters change
    const [sessionKey, setSessionKey] = useState(0);

    useEffect(() => saveProgress(progress), [progress]);

    // Build filtered list - ONLY depends on filters and sessionKey, NOT on progress
    const filtered = useMemo(() => {
        let list: Question[] = [...QUESTIONS];

        if (filters.type !== "all") {
            list = list.filter((q) => q.type === filters.type);
        }

        // For wrongOnly mode, we need progress but we'll handle it specially
        if (filters.mode === "wrongOnly") {
            // Use the current progress snapshot
            const currentProgress = loadProgress();
            list = list.filter((q) => (currentProgress.wrong[q.id] ?? 0) > (currentProgress.correct[q.id] ?? 0));
        }

        if (filters.shuffle) {
            list = shuffle(list);
        }

        if (filters.mode === "random20") {
            list = list.slice(0, Math.min(20, list.length));
        }

        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.type, filters.mode, filters.shuffle, sessionKey]);

    const [idx, setIdx] = useState(0);
    const current = filtered[idx];

    // State per question
    const [selected, setSelected] = useState<number | null>(null);
    const [fillValue, setFillValue] = useState("");
    const [revealed, setRevealed] = useState(false);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Reset states when question changes
    useEffect(() => {
        setSelected(null);
        setFillValue("");
        setRevealed(false);
        setIsCorrect(null);
        if (current?.type === "fill_in_blank") {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [idx, current?.id]);

    // Reset index when filters change
    useEffect(() => {
        setIdx(0);
        setSessionKey(k => k + 1);
    }, [filters.type, filters.mode, filters.shuffle]);

    const total = filtered.length;

    const stats = useMemo(() => {
        const seen = Object.values(progress.seen).reduce((a, b) => a + b, 0);
        const correct = Object.values(progress.correct).reduce((a, b) => a + b, 0);
        const wrong = Object.values(progress.wrong).reduce((a, b) => a + b, 0);
        return { seen, correct, wrong };
    }, [progress]);

    const markSeen = useCallback((qid: string) => {
        setProgress((p) => ({
            ...p,
            seen: { ...p.seen, [qid]: (p.seen[qid] ?? 0) + 1 },
        }));
    }, []);

    const markCorrect = useCallback((qid: string) => {
        setProgress((p) => ({
            ...p,
            correct: { ...p.correct, [qid]: (p.correct[qid] ?? 0) + 1 },
        }));
    }, []);

    const markWrong = useCallback((qid: string) => {
        setProgress((p) => ({
            ...p,
            wrong: { ...p.wrong, [qid]: (p.wrong[qid] ?? 0) + 1 },
        }));
    }, []);

    const toggleStar = useCallback((qid: string) => {
        setProgress((p) => ({
            ...p,
            starred: { ...p.starred, [qid]: !p.starred[qid] },
        }));
    }, []);

    // Instant check when selecting option (for multiple choice)
    const handleOptionClick = useCallback((optIdx: number) => {
        if (revealed || !current) return;

        setSelected(optIdx);
        markSeen(current.id);

        const ok = optIdx === current.correctIndex;
        setIsCorrect(ok);

        if (ok) {
            markCorrect(current.id);
        } else {
            markWrong(current.id);
        }

        setRevealed(true);
    }, [revealed, current, markSeen, markCorrect, markWrong]);

    // Check fill-in-blank answer
    const checkFill = useCallback(() => {
        if (!current || current.type !== "fill_in_blank" || !fillValue.trim()) return;

        markSeen(current.id);
        const ok = normalize(fillValue) === normalize(current.correctAnswer || "");
        setIsCorrect(ok);

        if (ok) {
            markCorrect(current.id);
        } else {
            markWrong(current.id);
        }

        setRevealed(true);
    }, [current, fillValue, markSeen, markCorrect, markWrong]);

    const next = useCallback(() => {
        if (idx < total - 1) setIdx((v) => v + 1);
    }, [idx, total]);

    const prev = useCallback(() => {
        if (idx > 0) setIdx((v) => v - 1);
    }, [idx]);

    // Keyboard shortcuts
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (!current) return;

            // Fill-in-blank: Enter to check, then Enter again to next
            if (e.target instanceof HTMLInputElement) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    if (!revealed) checkFill();
                    else next();
                }
                return;
            }

            if (e.key === "Enter") {
                if (revealed) next();
            }

            if (e.key === "Backspace" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                prev();
            }

            // Number keys for quick selection
            if ((current.type === "multiple_choice_one_correct" ||
                current.type === "multiple_choice_best_answer" ||
                current.type === "true_false") && !revealed && current.options) {
                const n = Number(e.key);
                if (!Number.isNaN(n) && n >= 1 && n <= current.options.length) {
                    handleOptionClick(n - 1);
                }
            }
        }

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [current, revealed, checkFill, next, prev, handleOptionClick]);

    const empty = total === 0;
    const progressPercent = total > 0 ? ((idx + 1) / total) * 100 : 0;

    // Get unique types for filter dropdown
    const availableTypes = useMemo(() => {
        const types = new Set(QUESTIONS.map(q => q.type));
        return Array.from(types);
    }, []);

    return (
        <div className="container">
            {/* Header Card */}
            <div className="card">
                <div className="row">
                    <div>
                        <h1>🎓 {META.title.split(" ").slice(0, 4).join(" ")}</h1>
                        <p className="small">{META.description}</p>
                    </div>
                    <div className="spacer" />
                    <button
                        className="btn danger"
                        onClick={() => {
                            if (confirm("Xóa toàn bộ tiến độ?")) {
                                localStorage.removeItem(LS_KEY);
                                setProgress({ seen: {}, wrong: {}, correct: {}, starred: {} });
                            }
                        }}
                    >
                        🗑️ Reset
                    </button>
                </div>

                <div className="hr" />

                {/* Filters */}
                <div className="row">
                    <label className="small">Chế độ</label>
                    <select
                        className="select"
                        value={filters.mode}
                        onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value as Filters["mode"] }))}
                    >
                        <option value="random20">Random 20 câu</option>
                        <option value="all">Toàn bộ theo lọc</option>
                        <option value="wrongOnly">Ôn câu sai</option>
                    </select>

                    <label className="small">Loại câu</label>
                    <select
                        className="select"
                        value={filters.type}
                        onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))}
                    >
                        <option value="all">Tất cả ({QUESTIONS.length} câu)</option>
                        {availableTypes.map(t => (
                            <option key={t} value={t}>
                                {typeLabel(t)} ({QUESTIONS.filter(q => q.type === t).length})
                            </option>
                        ))}
                    </select>

                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={filters.shuffle}
                            onChange={(e) => setFilters((f) => ({ ...f, shuffle: e.target.checked }))}
                        />
                        Trộn câu
                    </label>
                </div>

                {/* Stats */}
                <div className="stats-bar">
                    <div className="stat-item">
                        <span className="icon">📝</span>
                        <span className="small">Đã làm:</span>
                        <span className="value">{stats.seen}</span>
                    </div>
                    <div className="stat-item">
                        <span className="icon">✅</span>
                        <span className="small">Đúng:</span>
                        <span className="value" style={{ color: "var(--accent-success)" }}>{stats.correct}</span>
                    </div>
                    <div className="stat-item">
                        <span className="icon">❌</span>
                        <span className="small">Sai:</span>
                        <span className="value" style={{ color: "var(--accent-danger)" }}>{stats.wrong}</span>
                    </div>
                    <div className="spacer" />
                    <div className="stat-item">
                        <span className="badge">Bộ đề: {total} câu</span>
                    </div>
                </div>
            </div>

            {/* Quiz Card */}
            <div className="card animate-fade-in" key={current?.id ?? "empty"}>
                {empty ? (
                    <div className="empty-state">
                        <div className="icon">📭</div>
                        <h3>Không có câu nào</h3>
                        <p>Thử đổi "Chế độ / Loại câu" để lọc câu hỏi khác.</p>
                    </div>
                ) : (
                    <>
                        {/* Question Header */}
                        <div className="row">
                            <span className="badge">
                                Câu <b>{idx + 1}</b>/<b>{total}</b>
                            </span>
                            <span className="badge">{current.typeLabel}</span>
                            <div className="spacer" />
                            <button
                                className={`btn star ${progress.starred[current.id] ? "active" : ""}`}
                                onClick={() => toggleStar(current.id)}
                                title={progress.starred[current.id] ? "Bỏ đánh dấu" : "Đánh dấu câu"}
                            >
                                {progress.starred[current.id] ? "★" : "☆"}
                            </button>
                        </div>

                        {/* Progress Bar */}
                        <div className="progress-bar">
                            <div className="fill" style={{ width: `${progressPercent}%` }} />
                        </div>

                        {/* Question Prompt */}
                        <div className="question-prompt">{current.prompt}</div>

                        {/* Render per type */}
                        {current.type === "fill_in_blank" && (
                            <div style={{ marginTop: 12 }}>
                                <input
                                    ref={inputRef}
                                    className="input"
                                    placeholder="Nhập đáp án..."
                                    value={fillValue}
                                    onChange={(e) => setFillValue(e.target.value)}
                                    disabled={revealed}
                                />
                                {!revealed && (
                                    <button
                                        className="btn primary"
                                        onClick={checkFill}
                                        disabled={!fillValue.trim()}
                                        style={{ marginTop: 8 }}
                                    >
                                        Kiểm tra <span className="kbd">Enter</span>
                                    </button>
                                )}
                                {revealed && (
                                    <div className="explanation" style={{ marginTop: 12 }}>
                                        <div className="label">Đáp án đúng</div>
                                        <div className="content" style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--accent-success)" }}>
                                            {current.correctAnswer}
                                        </div>
                                        {isCorrect !== null && (
                                            <div style={{ marginTop: 8, fontWeight: 600, color: isCorrect ? "var(--accent-success)" : "var(--accent-danger)" }}>
                                                {isCorrect ? "✅ Chính xác!" : "❌ Chưa đúng"}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {(current.type === "multiple_choice_one_correct" ||
                            current.type === "multiple_choice_best_answer" ||
                            current.type === "true_false") && current.options && (
                                <div className="opts">
                                    {current.options.map((op, i) => {
                                        const isSel = selected === i;
                                        const isCorrectOpt = revealed && i === current.correctIndex;
                                        const isWrongOpt = revealed && isSel && i !== current.correctIndex;

                                        return (
                                            <div
                                                key={i}
                                                className={`opt ${revealed ? "revealed" : ""} ${isSel ? "selected" : ""} ${isCorrectOpt ? "correct" : ""} ${isWrongOpt ? "wrong" : ""}`}
                                                onClick={() => handleOptionClick(i)}
                                                role="button"
                                                tabIndex={0}
                                            >
                                                <span className="num">{i + 1}</span>
                                                <span>{op}</span>
                                                {isCorrectOpt && <span style={{ marginLeft: "auto" }}>✓</span>}
                                                {isWrongOpt && <span style={{ marginLeft: "auto" }}>✗</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                        {/* Result feedback */}
                        {revealed && isCorrect !== null && current.type !== "fill_in_blank" && (
                            <div
                                className="result-feedback"
                                style={{
                                    marginTop: 12,
                                    padding: "12px 16px",
                                    borderRadius: 8,
                                    fontWeight: 600,
                                    background: isCorrect ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                    color: isCorrect ? "var(--accent-success)" : "var(--accent-danger)",
                                    border: `1px solid ${isCorrect ? "var(--accent-success)" : "var(--accent-danger)"}`
                                }}
                            >
                                {isCorrect ? "✅ Chính xác!" : "❌ Sai rồi!"}
                            </div>
                        )}

                        {/* Explanation */}
                        {revealed && current.explanation && (
                            <div className="explanation">
                                <div className="label">💡 Giải thích</div>
                                <div className="content">{current.explanation}</div>
                            </div>
                        )}

                        <div className="hr" />

                        {/* Navigation */}
                        <div className="row">
                            <button className="btn" onClick={prev} disabled={idx === 0}>
                                ← Quay lại
                            </button>

                            {revealed && (
                                <button className="btn primary" onClick={next} disabled={idx >= total - 1}>
                                    Câu tiếp <span className="kbd">Enter</span>
                                </button>
                            )}

                            <div className="spacer" />

                            <div className="small">
                                Phím tắt: <span className="kbd">1-4</span> chọn nhanh | <span className="kbd">Enter</span> tiếp tục
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Tips Card */}
            <div className="card">
                <h2>💡 Mẹo ôn thi hiệu quả</h2>
                <div className="small" style={{ lineHeight: 1.8 }}>
                    • <b>Click chọn đáp án</b> → Hiển thị kết quả ngay lập tức<br />
                    • <b>Random 20 câu</b> → Làm nhanh lấy nhịp<br />
                    • <b>Ôn câu sai</b> → Cày lại phần hay nhầm (rất hiệu quả trước thi)<br />
                    • Lọc theo <b>Loại câu</b> để tập trung: Điền khuyết (thuộc định nghĩa), Tình huống (phân biệt cố ý/vô ý)<br />
                    • Dùng phím <span className="kbd">1-4</span> để chọn nhanh, <span className="kbd">Enter</span> để tiếp tục
                </div>
            </div>
        </div>
    );
}
