import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';

@Component({
    selector: 'app-historial-pago',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './historial-pago.html',
    styleUrl: './historial-pago.css'
})
export class HistorialPagoComponent {
    periodos: any[] = [];
    selectedPeriodo: string = '';
    planillaData: any = null;
    loading: boolean = false;
    errorNotFound: boolean = false;

    selectedYear: number = new Date().getFullYear();
    years: number[] = [];

    constructor(private cdr: ChangeDetectorRef, private notification: NotificationService) {
        this.generateYears();
        this.loadPeriodos();
    }

    generateYears() {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear; i >= 2024; i--) {
            this.years.push(i);
        }
    }

    async loadPeriodos() {
        try {
            const monthNames = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
            ];

            const response = await fetch(API_URL + '/api/historial-pago', {
                headers: getAuthHeaders()
            });
            let savedPeriodos: any[] = [];
            if (response.ok) {
                savedPeriodos = await response.json();
            }

            this.periodos = savedPeriodos.filter((p: any) => Number(p.año) === Number(this.selectedYear));
            this.cdr.detectChanges();
        } catch (error) {
            console.error('Error cargando periodos:', error);
        }
    }

    onYearChange() {
        this.selectedPeriodo = '';
        this.planillaData = null;
        this.loadPeriodos();
    }

    async consultarPeriodo() {
        if (!this.selectedPeriodo) return;
        this.loading = true;
        this.planillaData = null;
        this.errorNotFound = false;

        try {
            const response = await fetch(API_URL + `/api/historial-pago/${this.selectedPeriodo}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                this.planillaData = await response.json();
            } else {
                this.errorNotFound = true;
            }
        } catch (error) {
            console.error('Error consultando:', error);
            this.notification.error('Error de conexión al obtener el historial.');
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    getTotalSueldos(): number {
        if (!this.planillaData) return 0;
        return this.planillaData.empleados.reduce((sum: number, e: any) => sum + (e.sueldo || 0), 0);
    }

    getTotalBonos(): number {
        if (!this.planillaData) return 0;
        return this.planillaData.empleados.reduce((sum: number, e: any) => sum + (e.bonos || 0), 0);
    }

    getTotalDescuentos(): number {
        if (!this.planillaData) return 0;
        return this.planillaData.empleados.reduce((sum: number, e: any) => sum + (e.totalDescuento || 0), 0);
    }

    getTotalNeto(): number {
        if (!this.planillaData) return 0;
        return this.planillaData.empleados.reduce((sum: number, e: any) => sum + (e.remuneracionNeta || 0), 0);
    }
}
