import { deleteButtonIconStyle } from "../styles";

export const TrashIcon = () => (
  <svg
    style={deleteButtonIconStyle}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M9 3h6a1 1 0 0 1 1 1v1h4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 5h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
