import { Injectable, signal } from '@angular/core';

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    duration?: number;
}

export interface ConfirmData {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    checkboxLabel?: string;
    resolve: (value: { confirmed: boolean, checkboxValue: boolean }) => void;
}

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    toasts = signal<Toast[]>([]);
    confirmData = signal<ConfirmData | null>(null);
    private nextId = 0;

    success(message: string, duration = 3000) {
        this.addToast(message, 'success', duration);
    }

    error(message: string, duration = 4000) {
        this.addToast(message, 'error', duration);
    }

    info(message: string, duration = 3000) {
        this.addToast(message, 'info', duration);
    }

    warning(message: string, duration = 4000) {
        this.addToast(message, 'warning', duration);
    }

    private addToast(message: string, type: Toast['type'], duration: number) {
        const id = this.nextId++;
        this.toasts.update(current => [...current, { id, message, type, duration }]);

        if (duration > 0) {
            setTimeout(() => {
                this.removeToast(id);
            }, duration);
        }
    }

    removeToast(id: number) {
        this.toasts.update(current => current.filter(t => t.id !== id));
    }

    confirm(message: string, title = 'Confirmar Acción', confirmText = 'Confirmar', cancelText = 'Cancelar', checkboxLabel?: string): Promise<{ confirmed: boolean, checkboxValue: boolean }> {
        return new Promise((resolve) => {
            this.confirmData.set({
                title,
                message,
                confirmText,
                cancelText,
                checkboxLabel,
                resolve: (val) => {
                    this.confirmData.set(null);
                    resolve(val);
                }
            });
        });
    }
}
