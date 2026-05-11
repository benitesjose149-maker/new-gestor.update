import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuditService } from './audit.service';

@Component({
  selector: 'app-activity-logs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="logs-container">
      <div class="logs-header">
        <h4>Historial de Actividad Reciente</h4>
        <button class="refresh-btn" (click)="loadLogs()" [disabled]="loading">
          {{ loading ? 'Actualizando...' : '🔄 Refrescar' }}
        </button>
      </div>

      <div *ngIf="loading && logs.length === 0" class="loading-state">
        Cargando historial...
      </div>

      <div *ngIf="!loading && logs.length === 0" class="empty-state">
        No hay actividad registrada recientemente.
      </div>

      <div class="timeline" *ngIf="logs.length > 0">
        <div class="timeline-item" *ngFor="let log of logs">
          <div class="timeline-icon" [ngClass]="getModuleClass(log.MODULE)">
            <span [innerHTML]="getModuleIcon(log.MODULE)"></span>
          </div>
          <div class="timeline-content">
            <div class="log-header">
              <span class="user-email">{{ log.USER_EMAIL }}</span>
              <span class="log-date">{{ log.CREATED_AT | date:'short' }}</span>
            </div>
            <p class="log-action">{{ log.ACTION }}</p>
            <span class="module-tag">{{ log.MODULE }}</span>
            <p *ngIf="log.DETAILS" class="log-details">{{ log.DETAILS }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .logs-container {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border: 1px solid #e2e8f0;
      margin-top: 2rem;
    }

    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 1rem;
    }

    .logs-header h4 {
      margin: 0;
      color: #1e293b;
      font-size: 1.1rem;
    }

    .refresh-btn {
      background: none;
      border: 1px solid #e2e8f0;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.8rem;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s;
    }

    .refresh-btn:hover:not(:disabled) {
      background: #f8fafc;
      border-color: #cbd5e1;
    }

    .timeline {
      position: relative;
      padding-left: 2rem;
      max-height: 400px;
      overflow-y: auto;
      padding-right: 1rem;
    }

    /* Custom scrollbar for timeline */
    .timeline::-webkit-scrollbar {
      width: 6px;
    }
    .timeline::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 4px;
    }
    .timeline::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    .timeline::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 0.75rem;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #e2e8f0;
      z-index: 0;
    }

    .timeline-item {
      position: relative;
      margin-bottom: 2rem;
    }

    .timeline-item:last-child {
      margin-bottom: 0;
    }

    .timeline-icon {
      position: absolute;
      left: -2rem;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 0.8rem;
      z-index: 1;
    }

    /* Module Colors */
    .timeline-icon.planilla { background: #3b82f6; }
    .timeline-icon.finanzas { background: #10b981; }
    .timeline-icon.configuracion { background: #8b5cf6; }
    .timeline-icon.empleados { background: #f59e0b; }
    .timeline-icon.movimientos { background: #ec4899; }

    .timeline-content {
      background: #f8fafc;
      padding: 1rem;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }

    .log-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      font-size: 0.75rem;
    }

    .user-email {
      font-weight: 700;
      color: #334155;
    }

    .log-date {
      color: #94a3b8;
    }

    .log-action {
      margin: 0;
      font-size: 0.9rem;
      color: #1e293b;
      font-weight: 500;
    }

    .module-tag {
      display: inline-block;
      margin-top: 0.5rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      font-weight: 600;
      color: #64748b;
      background: #e2e8f0;
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
    }

    .log-details {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: #64748b;
      font-style: italic;
    }

    .loading-state, .empty-state {
      padding: 3rem;
      text-align: center;
      color: #94a3b8;
      font-style: italic;
    }
  `]
})
export class ActivityLogsComponent implements OnInit {
  logs: any[] = [];
  loading = false;

  constructor(private audit: AuditService) { }

  ngOnInit() {
    this.loadLogs();
  }

  async loadLogs() {
    this.loading = true;
    try {
      this.logs = await this.audit.getLogs();
    } finally {
      this.loading = false;
    }
  }

  getModuleClass(module: string): string {
    if (!module) return '';
    return module.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  getModuleIcon(module: string): string {
    const m = this.getModuleClass(module);
    switch (m) {
      case 'planilla': return '📄';
      case 'finanzas': return '💰';
      case 'configuracion': return '⚙️';
      case 'empleados': return '👥';
      case 'movimientos': return '💸';
      default: return '📍';
    }
  }
}
