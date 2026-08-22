export default function Dashboard({ electionCount, totalVotesAcrossAll }) {
  return (
    <div className="card dashboard">
      <div className="stat">
        <span className="stat-value">{electionCount}</span>
        <span className="stat-label">Elections created</span>
      </div>
      <div className="stat">
        <span className="stat-value">{totalVotesAcrossAll}</span>
        <span className="stat-label">Total votes cast</span>
      </div>
    </div>
  );
}
