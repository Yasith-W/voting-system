export default function Dashboard({
  electionCount,
  openElectionCount,
  totalVotesAcrossAll,
  totalVotersAcrossAll,
}) {
  return (
    <div className="card dashboard">
      <div className="stat">
        <span className="stat-value">{electionCount}</span>
        <span className="stat-label">Elections created</span>
      </div>
      <div className="stat">
        <span className="stat-value">{openElectionCount}</span>
        <span className="stat-label">Open right now</span>
      </div>
      <div className="stat">
        <span className="stat-value">{totalVotersAcrossAll}</span>
        <span className="stat-label">Voters registered</span>
      </div>
      <div className="stat">
        <span className="stat-value">{totalVotesAcrossAll}</span>
        <span className="stat-label">Total votes cast</span>
      </div>
    </div>
  );
}
