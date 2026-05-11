import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './dashboard.html',
    styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
    stats: any[] = [];
    birthdays: any[] = [];
    contractExpirations: any[] = [];
    unpaidInvoices: any[] = [];
    pendingCajaVirtual: any[] = [];
    totalPendingCaja: number = 0;

    constructor(private router: Router) { }
    async ngOnInit() {
        await this.loadStats();
    }

    async loadStats() {
        try {
            const response = await fetch(`${API_URL}/api/dashboard/stats`, {
                headers: getAuthHeaders()
            });
            const data = await response.json();
            this.stats = data.stats || [];
            this.birthdays = data.birthdays || [];
            this.contractExpirations = data.contractExpirations || [];
            this.unpaidInvoices = data.unpaidInvoices || [];
            this.pendingCajaVirtual = data.pendingCajaVirtual || [];
            this.totalPendingCaja = data.totalPendingCaja || 0;
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
            this.stats = [
                { title: 'Error', value: '---', change: 'Error de conexión', icon: '❌', color: 'red' }
            ];
        }
    }
    goToFinance(invoiceId: any) {
        this.router.navigate(['/finance'], { queryParams: { highlight: invoiceId } });
    }
}