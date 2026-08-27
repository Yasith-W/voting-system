import { useState } from "react";

function toUnixSeconds(datetimeLocalValue) {
  return Math.floor(new Date(datetimeLocalValue).getTime() / 1000);
}

export default function CreateElectionForm({ contract, onCreated }) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const updateOption = (index, value) => {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  };

  const addOption = () => setOptions((prev) => [...prev, ""]);
  const removeOption = (index) =>
    setOptions((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!title.trim()) return setError("Give the election a title.");
    if (cleanOptions.length < 2) return setError("Add at least two options.");
    if (!start || !end) return setError("Set a start and end time.");

    const startTs = toUnixSeconds(start);
    const endTs = toUnixSeconds(end);
    if (endTs <= startTs) return setError("End time must be after start time.");

    try {
      setSubmitting(true);
      const tx = await contract.createElection(title.trim(), cleanOptions, startTs, endTs);
      await tx.wait();

      setTitle("");
      setOptions(["", ""]);
      setStart("");
      setEnd("");
      onCreated?.();
    } catch (err) {
      console.error(err);
      setError(err?.reason || err?.shortMessage || err?.message || "Transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card create-election" onSubmit={handleSubmit}>
      <span className="eyebrow">ORGANISER WORKSPACE</span>
      <h2>Create an election</h2>
      <p className="muted">
        Only addresses authorised as organisers can create elections. Voters must then
        be individually registered before they can vote.
      </p>

      <label>
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Student Council President"
        />
      </label>

      <label>Options</label>
      {options.map((opt, i) => (
        <div className="option-row" key={i}>
          <input
            aria-label={`Candidate option ${i + 1}`}
            value={opt}
            onChange={(e) => updateOption(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
          />
          {options.length > 2 && (
            <button type="button" className="ghost" onClick={() => removeOption(i)}>
              Remove
            </button>
          )}
        </div>
      ))}
      <button type="button" className="ghost" onClick={addOption}>
        + Add option
      </button>

      <div className="two-col">
        <label>
          Start time
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          End time (deadline)
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <p className="muted small">
        Times use your device's local timezone. Allow enough time for voter
        registration and transaction confirmation.
      </p>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create election"}
      </button>
    </form>
  );
}
