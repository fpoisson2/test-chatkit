import { demoLabActivity } from "./demoData";
import type { LabActivity, LabAssessment, LabAttempt } from "./types";

const ATTEMPT_KEY = "edxo.lab.attempt";
const ASSESSMENT_KEY = "edxo.lab.assessment";

export function loadLabActivity(_activityId: string): LabActivity {
  return demoLabActivity;
}

export function loadLabAttempt(activityId: string): LabAttempt {
  const raw = localStorage.getItem(`${ATTEMPT_KEY}.${activityId}`);
  if (raw) return JSON.parse(raw) as LabAttempt;
  const now = new Date().toISOString();
  const attempt: LabAttempt = {
    id: `attempt-${Date.now()}`,
    activityId,
    startedAt: now,
    status: "in_progress",
    responses: {},
    attachments: [],
    feedback: [],
    revisionCount: 0,
    lastSavedAt: now,
  };
  saveLabAttempt(attempt);
  return attempt;
}

export function saveLabAttempt(attempt: LabAttempt) {
  localStorage.setItem(`${ATTEMPT_KEY}.${attempt.activityId}`, JSON.stringify({ ...attempt, lastSavedAt: new Date().toISOString() }));
}

export function loadAssessment(activityId: string): LabAssessment | null {
  const raw = localStorage.getItem(`${ASSESSMENT_KEY}.${activityId}`);
  return raw ? (JSON.parse(raw) as LabAssessment) : null;
}

export function saveAssessment(activityId: string, assessment: LabAssessment) {
  localStorage.setItem(`${ASSESSMENT_KEY}.${activityId}`, JSON.stringify(assessment));
}

export function clearLabDemo(activityId: string) {
  localStorage.removeItem(`${ATTEMPT_KEY}.${activityId}`);
  localStorage.removeItem(`${ASSESSMENT_KEY}.${activityId}`);
}
