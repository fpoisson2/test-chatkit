export type LabFieldType = "textarea" | "text" | "number" | "select" | "image";

export type LabField = {
  id: string;
  label: string;
  prompt: string;
  type: LabFieldType;
  required?: boolean;
  options?: string[];
  criterionId?: string;
  placeholder?: string;
};

export type LabSection = {
  id: string;
  title: string;
  description: string;
  fields: LabField[];
};

export type LabCriterion = {
  id: string;
  label: string;
  description: string;
  weight: number;
  maxPoints: number;
};

export type LabActivity = {
  id: string;
  title: string;
  courseName: string;
  introduction: string;
  durationSeconds: number;
  sections: LabSection[];
  criteria: LabCriterion[];
  adaptiveQuestionsEnabled: boolean;
  maxAdaptiveQuestions: number;
};

export type LabAttachment = {
  id: string;
  fieldId: string;
  name: string;
  type: string;
  dataUrl: string;
};

export type LabFeedback = {
  id: string;
  createdAt: string;
  author: "IA" | "Enseignant";
  message: string;
  criterionId?: string;
};

export type LabAttemptStatus = "in_progress" | "submitted" | "revision_requested" | "validated" | "expired";

export type LabAttempt = {
  id: string;
  activityId: string;
  startedAt: string;
  submittedAt?: string;
  status: LabAttemptStatus;
  responses: Record<string, string>;
  attachments: LabAttachment[];
  feedback: LabFeedback[];
  proposedScore?: number;
  validatedScore?: number;
  revisionCount: number;
  lastSavedAt: string;
};

export type LabAssessment = {
  score: number;
  maxScore: number;
  summary: string;
  byCriterion: Record<string, { score: number; feedback: string }>;
  adaptiveQuestions: string[];
};
