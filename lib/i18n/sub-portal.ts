export type Language = 'en' | 'es'

export const translations = {
  // Header
  subContractorPortal: {
    en: 'Sub Contractor Portal',
    es: 'Portal de Subcontratistas',
  },
  signOut: {
    en: 'Sign Out',
    es: 'Cerrar Sesión',
  },

  // Navigation
  jobs: {
    en: 'Jobs',
    es: 'Trabajos',
  },
  workOrders: {
    en: 'Work Orders',
    es: 'Órdenes de Trabajo',
  },

  // Stats
  upcoming: {
    en: 'Upcoming',
    es: 'Próximos',
  },
  inProgress: {
    en: 'In Progress',
    es: 'En Progreso',
  },
  completed: {
    en: 'Completed',
    es: 'Completado',
  },
  all: {
    en: 'All',
    es: 'Todos',
  },

  // Status labels
  statusPending: {
    en: 'Pending',
    es: 'Pendiente',
  },
  statusAssigned: {
    en: 'Assigned',
    es: 'Asignado',
  },
  statusScheduled: {
    en: 'Scheduled',
    es: 'Programado',
  },
  statusInProgress: {
    en: 'In Progress',
    es: 'En Progreso',
  },
  statusCompleted: {
    en: 'Completed',
    es: 'Completado',
  },
  statusCancelled: {
    en: 'Cancelled',
    es: 'Cancelado',
  },
  statusOnHold: {
    en: 'On Hold',
    es: 'En Espera',
  },
  statusComplete: {
    en: 'Complete',
    es: 'Completo',
  },

  // Job details
  jobDetails: {
    en: 'Job Details',
    es: 'Detalles del Trabajo',
  },
  customer: {
    en: 'Customer',
    es: 'Cliente',
  },
  address: {
    en: 'Address',
    es: 'Dirección',
  },
  jobAddress: {
    en: 'Job Address',
    es: 'Dirección del Trabajo',
  },
  scheduledDate: {
    en: 'Scheduled Date',
    es: 'Fecha Programada',
  },
  scheduled: {
    en: 'Scheduled',
    es: 'Programado',
  },
  status: {
    en: 'Status',
    es: 'Estado',
  },
  openInMaps: {
    en: 'Open in Maps',
    es: 'Abrir en Mapas',
  },
  permit: {
    en: 'Permit',
    es: 'Permiso',
  },
  required: {
    en: 'Required',
    es: 'Requerido',
  },
  estHours: {
    en: 'Est. {hours} hours',
    es: 'Est. {hours} horas',
  },

  // Scope
  scopeOfWork: {
    en: 'Scope of Work',
    es: 'Alcance del Trabajo',
  },
  product: {
    en: 'Product',
    es: 'Producto',
  },
  workItems: {
    en: 'Work Items',
    es: 'Elementos de Trabajo',
  },
  specialInstructions: {
    en: 'Special Instructions',
    es: 'Instrucciones Especiales',
  },
  notes: {
    en: 'Notes',
    es: 'Notas',
  },
  filesAndPhotos: {
    en: 'Files & Photos',
    es: 'Archivos y Fotos',
  },
  downloadJobPacket: {
    en: 'Download Job Packet PDF',
    es: 'Descargar PDF del Paquete de Trabajo',
  },

  // Actions
  startJob: {
    en: 'Start Job',
    es: 'Iniciar Trabajo',
  },
  starting: {
    en: 'Starting...',
    es: 'Iniciando...',
  },
  markComplete: {
    en: 'Mark Complete',
    es: 'Marcar Completo',
  },
  completeJob: {
    en: 'Complete Job',
    es: 'Completar Trabajo',
  },
  completing: {
    en: 'Completing...',
    es: 'Completando...',
  },
  cancel: {
    en: 'Cancel',
    es: 'Cancelar',
  },
  submit: {
    en: 'Submit',
    es: 'Enviar',
  },
  submitting: {
    en: 'Submitting...',
    es: 'Enviando...',
  },

  // Work Order specific
  workOrderDetails: {
    en: 'Work Order Details',
    es: 'Detalles de la Orden de Trabajo',
  },
  description: {
    en: 'Description',
    es: 'Descripción',
  },
  materials: {
    en: 'Materials',
    es: 'Materiales',
  },
  viewDetails: {
    en: 'View Details',
    es: 'Ver Detalles',
  },
  noWorkOrders: {
    en: 'No work orders assigned',
    es: 'No hay órdenes de trabajo asignadas',
  },
  noJobs: {
    en: 'No jobs found',
    es: 'No se encontraron trabajos',
  },

  // Completion flow
  completeWorkOrder: {
    en: 'Complete Work Order',
    es: 'Completar Orden de Trabajo',
  },
  completionNote: {
    en: 'Completion Note',
    es: 'Nota de Finalización',
  },
  completionNotePlaceholder: {
    en: 'Describe the work completed and any observations',
    es: 'Describa el trabajo completado y cualquier observación',
  },
  completionNoteRequired: {
    en: 'Completion note is required',
    es: 'La nota de finalización es requerida',
  },
  uploadPhotos: {
    en: 'Upload Photos',
    es: 'Subir Fotos',
  },
  workDone: {
    en: 'Work Done',
    es: 'Trabajo Realizado',
  },
  cleanup: {
    en: 'Cleanup',
    es: 'Limpieza',
  },
  workDonePhotos: {
    en: 'Work Done Photos',
    es: 'Fotos del Trabajo Realizado',
  },
  cleanupPhotos: {
    en: 'Cleanup Photos',
    es: 'Fotos de Limpieza',
  },
  addWorkDonePhoto: {
    en: 'Add Work Done Photo',
    es: 'Agregar Foto del Trabajo',
  },
  addCleanupPhoto: {
    en: 'Add Cleanup Photo',
    es: 'Agregar Foto de Limpieza',
  },
  submitCompletion: {
    en: 'Submit Completion',
    es: 'Enviar Finalización',
  },
  workDonePhotoRequired: {
    en: 'At least 1 work done photo required',
    es: 'Se requiere al menos 1 foto del trabajo realizado',
  },
  cleanupPhotoRequired: {
    en: 'At least 1 cleanup photo required',
    es: 'Se requiere al menos 1 foto de limpieza',
  },
  submittedSuccessfully: {
    en: 'Submitted successfully',
    es: 'Enviado exitosamente',
  },
  errorSubmitting: {
    en: 'Error submitting, please try again',
    es: 'Error al enviar, por favor intente de nuevo',
  },
  removePhoto: {
    en: 'Remove',
    es: 'Eliminar',
  },
  photos: {
    en: 'photos',
    es: 'fotos',
  },

  // Messages
  readyToStart: {
    en: 'Ready to start this job?',
    es: '¿Listo para iniciar este trabajo?',
  },
  jobInProgress: {
    en: 'Job in progress. Mark complete when finished.',
    es: 'Trabajo en progreso. Marque como completo cuando termine.',
  },
  completionNotesOptional: {
    en: 'Completion Notes (optional)',
    es: 'Notas de Finalización (opcional)',
  },
  anyNotesPlaceholder: {
    en: 'Any notes about the completed work...',
    es: 'Cualquier nota sobre el trabajo completado...',
  },

  // Work order types
  typeGoBack: {
    en: 'Go Back',
    es: 'Volver',
  },
  typeRepair: {
    en: 'Repair',
    es: 'Reparación',
  },
  typeWarranty: {
    en: 'Warranty',
    es: 'Garantía',
  },
  typePunchList: {
    en: 'Punch List',
    es: 'Lista de Pendientes',
  },
  typeInspection: {
    en: 'Inspection',
    es: 'Inspección',
  },
  typeInstall: {
    en: 'Install',
    es: 'Instalación',
  },
  typeServiceCall: {
    en: 'Service Call',
    es: 'Llamada de Servicio',
  },

  // Priority
  priorityLow: {
    en: 'Low',
    es: 'Baja',
  },
  priorityNormal: {
    en: 'Normal',
    es: 'Normal',
  },
  priorityHigh: {
    en: 'High',
    es: 'Alta',
  },
  priorityUrgent: {
    en: 'Urgent',
    es: 'Urgente',
  },

  // Completion photos section on ops side
  subCompletionPhotos: {
    en: 'Sub Completion Photos',
    es: 'Fotos de Finalización del Sub',
  },
  subCompletionNote: {
    en: 'Sub Completion Note',
    es: 'Nota de Finalización del Sub',
  },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Language): string {
  return translations[key][lang]
}

export function getStatusLabel(status: string, lang: Language): string {
  const statusMap: Record<string, TranslationKey> = {
    pending: 'statusPending',
    assigned: 'statusAssigned',
    scheduled: 'statusScheduled',
    in_progress: 'statusInProgress',
    completed: 'statusCompleted',
    complete: 'statusComplete',
    cancelled: 'statusCancelled',
    on_hold: 'statusOnHold',
  }
  const key = statusMap[status]
  return key ? t(key, lang) : status
}

export function getWorkOrderTypeLabel(type: string, lang: Language): string {
  const typeMap: Record<string, TranslationKey> = {
    go_back: 'typeGoBack',
    repair: 'typeRepair',
    warranty: 'typeWarranty',
    punch_list: 'typePunchList',
    inspection: 'typeInspection',
    install: 'typeInstall',
    service_call: 'typeServiceCall',
  }
  const key = typeMap[type]
  return key ? t(key, lang) : type
}

export function getPriorityLabel(priority: string, lang: Language): string {
  const priorityMap: Record<string, TranslationKey> = {
    low: 'priorityLow',
    normal: 'priorityNormal',
    high: 'priorityHigh',
    urgent: 'priorityUrgent',
  }
  const key = priorityMap[priority]
  return key ? t(key, lang) : priority
}
