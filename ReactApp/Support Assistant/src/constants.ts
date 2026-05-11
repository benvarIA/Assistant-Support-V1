import type { JiraProposal, IdentificationCategory } from './types'

export const MIN_ANALYSIS_DURATION_MS = 1800
export const TREATMENTS_STORAGE_KEY = 'support-assistant:treatments:v1'
export const ASSISTANCE_STORAGE_KEY = 'support-assistant:assistance:v1'

export const ISSUE_TYPE_OPTIONS: JiraProposal['issueType'][] = [
  'Assistance',
  'Intervention',
  'Information',
  'Incident',
]

export const ISSUE_SUBTYPE_MAP: Record<
  JiraProposal['issueType'],
  { field: JiraProposal['subtypeField']; options: string[] }
> = {
  Assistance: {
    field: 'Type de déploiement',
    options: ['Onsite', 'Online', 'Mutualisée (Team+, Team, Partners)', 'TO BE DEFINED'],
  },
  Intervention: {
    field: "Type d'intervention",
    options: ['Setup', 'Update', 'Administration', 'Exploitation', 'License delivery'],
  },
  Information: {
    field: "Type d'info",
    options: ['Fonctionnelle', 'Technique', 'Business'],
  },
  Incident: {
    field: null,
    options: [],
  },
}

export const IDENTIFICATION_CATEGORIES: IdentificationCategory[] = [
  'Assistance',
  'Question',
  'Intervention livraison',
  'Intervention administration',
]

export const SEQUENCE_STEPS = ['Identification', 'Créer', 'Tracer', 'Clôturer'] as const
