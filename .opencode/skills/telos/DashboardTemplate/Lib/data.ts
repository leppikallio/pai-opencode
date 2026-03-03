// Dashboard template example data.
// This file exists primarily to satisfy template docs and serve as a starting point.

export interface ProjectBudget {
  oneTime: number;
  monthly: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: "In Progress" | "Planning" | "Complete";
  completion: number;
  budget: ProjectBudget;
}

// TODO: Replace with your actual project data.
export const projects: Project[] = [];
