import React from 'react';

interface ProgressBarProps {
  steps: Array<{ id: string; name: string; completed: boolean; active: boolean }>;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ steps }) => {
  return (
    <ul className="progress-bar">
      {steps.map((step, index) => (
        <li 
          key={step.id}
          className={`progress-step ${step.completed ? 'completed' : ''} ${step.active ? 'active' : ''}`}
        >
          <div className="step-circle">
            {step.completed ? '✓' : index + 1}
          </div>
          <span className="step-name">{step.name}</span>
        </li>
      ))}
    </ul>
  );
};

export default ProgressBar;