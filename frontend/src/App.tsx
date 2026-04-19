import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Layout/Shell';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import RiskAssessmentPage from './pages/RiskAssessmentPage';
import GraphGovernancePage from './pages/GraphGovernancePage';

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/risk-assessment" element={<RiskAssessmentPage />} />
          <Route path="/projects/:id/graph" element={<GraphGovernancePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
