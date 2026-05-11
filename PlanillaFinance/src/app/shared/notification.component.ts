
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService } from './notification.service';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- TOAST CONTAINER -->
    <div class="toast-container">
      @for (toast of notificationService.toasts(); track toast.id) {
        <div class="toast" [class]="toast.type" (click)="notificationService.removeToast(toast.id)">
          <div class="toast-icon">
            @if (toast.type === 'success') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            } @else if (toast.type === 'error') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            } @else if (toast.type === 'warning') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            } @else {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            }
          </div>
          <div class="toast-message">{{ toast.message }}</div>
          <button class="toast-close">&times;</button>
        </div>
      }
    </div>

    <!-- CONFIRM MODAL -->
    @if (notificationService.confirmData(); as config) {
      <div class="modal-backdrop">
        <div class="modal-container shadow-lg animate-in fade-in zoom-in duration-200">
          <div class="modal-content p-6 rounded-2xl bg-white dark:bg-gray-800">
            <div class="modal-header mb-4">
              <h3 class="text-xl font-bold text-gray-900 dark:text-white">{{ config.title }}</h3>
            </div>
            <div class="modal-body mb-6">
              <p class="text-gray-600 dark:text-gray-300 leading-relaxed">{{ config.message }}</p>
              
              @if (config.checkboxLabel) {
                <div class="modal-checkbox-container" (click)="localCheckboxValue = !localCheckboxValue">
                  <input type="checkbox" [(ngModel)]="localCheckboxValue" (click)="$event.stopPropagation()" />
                  <label>{{ config.checkboxLabel }}</label>
                </div>
              }
            </div>
            <div class="modal-actions flex justify-end gap-3">
              <button class="btn-cancel px-5 py-2.5 rounded-xl font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all border-none" 
                  (click)="handleResolve(false, config)">
                {{ config.cancelText || 'Cancelar' }}
              </button>
              <button class="btn-confirm px-5 py-2.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/30 transition-all border-none" 
                  (click)="handleResolve(true, config)">
                {{ config.confirmText || 'Confirmar' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styleUrls: ['./notification.component.css']
})
export class NotificationComponent {
  notificationService = inject(NotificationService);
  localCheckboxValue = false;

  handleResolve(confirmed: boolean, config: any) {
    config.resolve({ confirmed, checkboxValue: this.localCheckboxValue });
    this.localCheckboxValue = false; // Reset for next time
  }
}
