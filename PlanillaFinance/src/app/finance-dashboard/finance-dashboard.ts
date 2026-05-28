
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_URL, getAuthHeaders } from '../api-config';
import { NotificationService } from '../shared/notification.service';
import { AuditService } from '../shared/audit.service';

@Component({
    selector: 'app-finance-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './finance-dashboard.html',
    styleUrl: './finance-dashboard.css'
})
export class FinanceDashboardComponent implements OnInit {

    loading: boolean = false;
    items: any[] = [];
    thisMonthPaid: number = 0;
    thisMonthTotal: number = 0;
    thisMonthTotalGross: number = 0;
    thisMonthUnpaid: number = 0;
    totalPayrollNet: number = 0;

    serverBankTotals: any = {
        cajaVirtual: 0,
        cajaVirtualPendiente: 0,
        bcp: 0,
        interbank: 0,
        comisiones: 0
    };

    currentPage: number = 1;
    pageSize: any = 25;
    totalPages: number = 1;
    totalResults: number = 0;
    tableExpanded: boolean = false;
    editingBalances: boolean = false;
    bankBalances: any[] = [];

    showModal: boolean = false;
    showInvoiceModal: boolean = false;
    invoiceDetail: any = null;
    loadingInvoice: boolean = false;
    nuevoEgreso: any = this.getEmptyEgreso();
    categorias = ['Alimentación', 'Servicios', 'Transporte', 'Suministros', 'Planilla', 'Impuestos', 'Otros'];
    bancosLista = ['BCP', 'INTERBANK', 'YAPE', 'PLIN', 'CAJA VIRTUAL', 'OTRO'];
    tiposEgreso = ['MANUAL', 'YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'];

    movementTypes: any[] = [];
    bancos: any[] = [];
    debitAccounts: any[] = [];
    creditAccounts: any[] = [];
    codigosContables: any[] = [];
    transactionStatuses: any[] = [];

    filters = {
        searchText: '',
        banco: '',
        tipoMov: '',
        numFactura: '',
        fecha: ''
    };

    selectedMonth: number;
    selectedYear: number;
    months = [
        { id: 1, name: 'Enero' }, { id: 2, name: 'Febrero' }, { id: 3, name: 'Marzo' },
        { id: 4, name: 'Abril' }, { id: 5, name: 'Mayo' }, { id: 6, name: 'Junio' },
        { id: 7, name: 'Julio' }, { id: 8, name: 'Agosto' }, { id: 9, name: 'Septiembre' },
        { id: 10, name: 'Octubre' }, { id: 11, name: 'Noviembre' }, { id: 12, name: 'Diciembre' }
    ];
    years: number[] = [];

    constructor(
        private cdr: ChangeDetectorRef,
        private notification: NotificationService,
        private audit: AuditService,
        private route: ActivatedRoute
    ) {
        const now = new Date();
        this.selectedMonth = now.getMonth() + 1;
        this.selectedYear = now.getFullYear();
        for (let i = 0; i < 3; i++) {
            this.years.push(this.selectedYear - i);
        }
    }

    ngOnInit() {
        this.loadAll();
    }

    async loadAll() {
        this.loading = true;

        const highlightId = this.route.snapshot.queryParams['highlight'];
        if (highlightId) {
            this.pageSize = 'All';
            this.filters = { searchText: '', banco: '', tipoMov: '', numFactura: '', fecha: '' };
        }

        try {
            const currentMonth = this.selectedMonth;
            const currentYear = this.selectedYear;

            const parseToLocalMidnight = (dateInput: any) => {
                if (!dateInput) return 0;
                const d = new Date(dateInput);
                const localDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
                return localDate;
            };

            const [invoicesRes, egresosRes, mtRes, bancosRes, daRes, caRes, ccRes, tsRes, planillaRes] = await Promise.all([
                fetch(API_URL + `/api/whmcs/invoices?mes=${currentMonth}&anio=${currentYear}&page=${this.currentPage}&limit=${this.effectivePageSize}`, { headers: getAuthHeaders() }),
                fetch(API_URL + `/api/finance/egresos?mes=${currentMonth}&anio=${currentYear}`, { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/movement-types', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/bancos', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/debit-accounts', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/credit-accounts', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/codigo-contable', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/finance/transaction-status', { headers: getAuthHeaders() }),
                fetch(API_URL + '/api/planilla-borrador', { headers: getAuthHeaders() })
            ]);

            if (mtRes.ok) this.movementTypes = await mtRes.json();
            if (bancosRes.ok) this.bancos = await bancosRes.json();
            if (daRes.ok) {
                this.debitAccounts = await daRes.json();
                if (!this.debitAccounts.find((d: any) => (d.name || '').toLowerCase().includes('bbva'))) {
                    this.debitAccounts.push({ id: 'bbva-auto', name: 'BBVA' });
                }
                if (!this.debitAccounts.find((d: any) => (d.name || '').toLowerCase() === 'izipay cobrado')) {
                    this.debitAccounts.push({ id: 'izipay-cobrado', name: 'Izipay cobrado' });
                }
            }
            if (caRes.ok) this.creditAccounts = await caRes.json();
            if (ccRes.ok) this.codigosContables = await ccRes.json();
            if (tsRes.ok) this.transactionStatuses = await tsRes.json();

            let mergedItems: any[] = [];

            if (invoicesRes.ok) {
                const data = await invoicesRes.json();
                this.thisMonthPaid = data.thisMonthPaid || 0;
                this.thisMonthTotal = data.thisMonthTotal || 0;
                this.thisMonthTotalGross = data.thisMonthTotalGross || 0;
                this.thisMonthUnpaid = data.thisMonthUnpaid || 0;
                this.serverBankTotals = data.serverBankTotals || this.serverBankTotals;
                this.totalPages = this.pageSize === 'All' ? 1 : (data.totalPages || 1);
                this.totalResults = data.totalresults || 0;

                const mappedInvoices = (data.invoices || []).map((inv: any) => {
                    const localDate = parseToLocalMidnight(inv.fecha);
                    const item = {
                        ...inv,
                        fecha: localDate,
                        estadoLocal: inv.estadoLocal || 'Pendiente',
                        isEgreso: false,
                        sortDate: localDate ? localDate.getTime() : 0,
                        isScanning: false
                    };

                    if (item.banco) {
                        const bMatch = this.bancos.find((b: any) => b.name.toLowerCase() === item.banco.toLowerCase().trim());
                        if (bMatch) item.banco = bMatch.name;
                    }

                    if (item.cuentaDebito) {
                        const dMatch = this.debitAccounts.find((d: any) => d.name.toLowerCase() === item.cuentaDebito.toLowerCase().trim());
                        if (dMatch) item.cuentaDebito = dMatch.name;
                    }

                    const isIzipay = (item.tipoMovimiento || '').toLowerCase().includes('izipay') ||
                        (item.cuentaDebito || '').toLowerCase().includes('izipay');

                    if (isIzipay) {
                        const bancoCaja = this.bancos.find((b: any) => b.name.toLowerCase().includes('caja'));
                        if (!item.banco) item.banco = bancoCaja ? bancoCaja.name : 'CAJA VIRTUAL';

                        const ctaIzipay = this.debitAccounts.find((d: any) => d.name.toLowerCase().includes('izipay'));
                        item.cuentaDebito = ctaIzipay ? ctaIzipay.name : 'Izipay por cobrar';
                    } else {
                        if (!item.banco && item.WHMCS_InvoiceID) {
                            this.autoEscanearPDF(item, item.WHMCS_InvoiceID);
                        } else if (item.banco && !item.cuentaDebito) {
                            item.cuentaDebito = this.buscarCuentaDebitoPorBanco(item.banco);
                        } else if (item.banco && item.cuentaDebito) {
                            const verifyDMatch = this.debitAccounts.find((d: any) => d.name === item.cuentaDebito);
                            if (!verifyDMatch) {
                                item.cuentaDebito = this.buscarCuentaDebitoPorBanco(item.banco);
                            }
                        }
                    }

                    return item;
                });
                mergedItems = [...mergedItems, ...mappedInvoices];
            }

            if (egresosRes.ok) {
                const data = await egresosRes.json();
                console.log(`[FRONTEND DEBUG] Egresos recibidos: ${data.total}`, data.egresos);

                const mappedEgresos = (data.egresos || []).map((eg: any) => {
                    const localDate = parseToLocalMidnight(eg.fecha);
                    return {
                        ...eg,
                        fecha: localDate,
                        isEgreso: true,
                        montoBruto: eg.monto,
                        depositoSalida: eg.monto,
                        comision: 0,
                        sortDate: localDate ? localDate.getTime() : 0
                    };
                });
                mergedItems = [...mergedItems, ...mappedEgresos];
            }

            this.items = mergedItems.sort((a, b) => {
                const dateA = a.sortDate || 0;
                const dateB = b.sortDate || 0;
                if (dateB !== dateA) return dateB - dateA;
                return (b.id || 0) - (a.id || 0);
            });

            console.log(`[FRONTEND DEBUG] Total items combinados: ${this.items.length}`);

            if (planillaRes.ok) {
                const data = await planillaRes.json();
                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                this.totalPayrollNet = data.reduce((sum: number, emp: any) => {
                    const bonosDetalle = emp.bonosDetalle || [];
                    const validBonos = bonosDetalle.filter((b: any) => {
                        if (b.permanente) return true;
                        if (!b.fecha) return false;
                        const bd = new Date(b.fecha);
                        return bd.getMonth() === currentMonth && bd.getFullYear() === currentYear;
                    });
                    const bonosTotal = validBonos.reduce((s: number, b: any) => s + (b.monto || 0), 0);

                    const sueldo = emp.sueldo || 0;
                    const baseCalculo = sueldo + bonosTotal;

                    const hourlyRate = (baseCalculo / 240) * 1.25;
                    const montoHorasExtras = hourlyRate * (emp.horasExtras || 0);

                    const totalIngresos = sueldo + montoHorasExtras + bonosTotal;

                    let descuentoAfp = 0;
                    if (emp.tipoTrabajador === 'PLANILLA') {
                        let afpRate = 0;
                        const regimen = emp.regimenPensionario || '';
                        if (regimen.includes('SNP')) afpRate = 0.13;
                        else if (regimen.includes('AFP')) afpRate = 0.1138;

                        let baseAfp = totalIngresos;
                        if (emp.calculoAfpMinimo) baseAfp = 1130;
                        descuentoAfp = parseFloat((baseAfp * afpRate).toFixed(2));
                    }

                    const dayRate = baseCalculo / 30;
                    const hourRate = dayRate / 8;
                    const montoFaltas = parseFloat(((dayRate * (emp.faltasDias || 0)) + (hourRate * (emp.faltasHoras || 0))).toFixed(2));
                    let totalDescuento = descuentoAfp + (emp.adelanto || 0) + (emp.prestamo || 0) + montoFaltas + (emp.descuentoAdicional || 0);
                    totalDescuento = parseFloat(totalDescuento.toFixed(2));

                    let remuneracionNeta = totalIngresos - totalDescuento;
                    remuneracionNeta = parseFloat(remuneracionNeta.toFixed(2));

                    return sum + remuneracionNeta;
                }, 0);
            }

        } catch (error) {
            console.error('Error loading finance data:', error);
        } finally {
            this.loading = false;
            this.cdr.detectChanges();

            const highlightId = this.route.snapshot.queryParams['highlight'];
            if (highlightId) {
                this.highlightRow(highlightId);
            }
        }
    }

    highlightRow(id: any, attempts: number = 0) {
        if (attempts > 20) {
            console.warn('[Highlight] No se encontró el elemento tras 10 segundos:', id);
            return;
        }

        const row = document.getElementById(`invoice-row-${id}`);
        if (row) {
            console.log('[Highlight] Elemento encontrado, aplicando scroll y color');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.transition = 'background-color 0.5s ease-in-out, border 0.3s ease';
            row.style.backgroundColor = '#fef08a';
            row.style.borderLeft = '6px solid #eab308';

            setTimeout(() => {
                row.style.backgroundColor = '';
                row.style.borderLeft = '';
            }, 5000);
        } else {
            setTimeout(() => {
                this.highlightRow(id, attempts + 1);
            }, 500);
        }
    }

    get filteredItems(): any[] {
        const cm = this.selectedMonth - 1;
        const cy = this.selectedYear;
        const qid = this.route.snapshot.queryParams['highlight'];

        return this.items.filter(it => {
            if (qid && (it.id == qid || it.localId == qid)) return true;

            if (it.fecha) {
                const f = new Date(it.fecha);
                if (f.getMonth() !== cm || f.getFullYear() !== cy) return false;
            }

            const search = this.filters.searchText.toLowerCase();
            const matchSearch = !search ||
                (it.clienteConcepto || '').toLowerCase().includes(search) ||
                (it.comercio || '').toLowerCase().includes(search) ||
                (it.categoria || '').toLowerCase().includes(search);

            const matchBank = !this.filters.banco || it.banco === this.filters.banco;

            const typeFilter = this.filters.tipoMov;
            const itemType = it.isEgreso ? it.tipoEgreso : it.tipoMovimiento;
            const matchType = !typeFilter || itemType === typeFilter;

            const ref = this.filters.numFactura.toLowerCase();
            const matchRef = !ref ||
                (it.numFactura || '').toLowerCase().includes(ref) ||
                (it.referencia || '').toLowerCase().includes(ref) ||
                (it.observacion || '').toLowerCase().includes(ref);

            const matchFecha = !this.filters.fecha ||
                (it.fecha && new Date(it.fecha).toISOString().split('T')[0] === this.filters.fecha);

            return matchSearch && matchBank && matchType && matchRef && matchFecha;
        });
    }

    get paginatedItems(): any[] {
        const items = this.filteredItems;
        if (this.pageSize === 'All') return items;
        return items.slice(0, Number(this.pageSize));
    }


    get totalBruto(): number {
        if (this.thisMonthTotalGross > 0) return this.thisMonthTotalGross;
        return this.filteredItems.filter(i => !i.isEgreso).reduce((sum, inv) => sum + (inv.montoBruto || 0), 0);
    }

    get totalInterbank(): number {
        return this.serverBankTotals.interbank || 0;
    }

    get totalBcp(): number {
        return this.serverBankTotals.bcp || 0;
    }

    get totalCajaVirtual(): number {
        return this.serverBankTotals.cajaVirtual || 0;
    }

    get totalCajaVirtualPendiente(): number {
        return this.serverBankTotals.cajaVirtualPendiente || 0;
    }

    get balance1(): number {
        return 0;
    }

    get balance2(): number {
        return this.totalBruto - this.totalComisiones - this.totalEgresos;
    }

    initBankBalances() {
        this.bankBalances = [
            { icon: 'IB', name: 'INTERBANK', value: this.totalInterbank, css: 'interbank' },
            { icon: 'BC', name: 'BCP', value: this.totalBcp, css: 'bcp' },
            { icon: 'CV', name: 'CAJA VIRTUAL', value: this.totalCajaVirtual, css: 'caja' },
            { icon: 'B1', name: 'Balance 1', value: this.balance1, css: 'caja' },
            { icon: 'B2', name: 'Balance 2', value: this.balance2, css: 'caja' }
        ];
    }

    toggleEditBalances() {
        if (!this.editingBalances) {
            this.initBankBalances();
        }
        this.editingBalances = !this.editingBalances;
    }

    saveBankBalances() {
        this.editingBalances = false;
        this.notification.success('Balances actualizados correctamente');
    }

    get totalComisiones(): number {
        return this.serverBankTotals.comisiones || 0;
    }

    get totalDeposito(): number {
        return this.filteredItems.filter(i => !i.isEgreso).reduce((sum, inv) => sum + (inv.depositoSalida || 0), 0);
    }

    get totalEgresos(): number {
        return this.filteredItems.filter(i => i.isEgreso).reduce((sum, e) => sum + (e.monto || 0), 0);
    }

    getCurrentMonth(): string {
        const monthName = this.months.find(m => m.id === this.selectedMonth)?.name || '';
        return monthName + ' ' + this.selectedYear;
    }

    toggleEdit(inv: any) {
        inv.editing = !inv.editing;
        if (!inv.editing) {
            this.notification.success('Cambios guardados correctamente');
        }
    }

    onMontoBrutoChange(inv: any) {
        if (inv.isEgreso) return;
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.onFieldChange(inv);
    }

    onComisionChange(inv: any) {
        if (inv.isEgreso) return;
        inv.depositoSalida = (inv.montoBruto || 0) - (inv.comision || 0);
        this.onFieldChange(inv);
    }

    onBancoChange(inv: any) {
        if (inv.isEgreso) return;
        if (inv.banco) {
            inv.cuentaDebito = this.buscarCuentaDebitoPorBanco(inv.banco);
        }
        this.onFieldChange(inv);
    }

    onCuentaDebitoChange(inv: any) {
        if (inv.isEgreso) return;
        const cta = (inv.cuentaDebito || '').toLowerCase();
        if (cta === 'izipay cobrado') {
            inv.estadoLocal = 'Conciliado';
        } else if (cta === 'izipay por cobrar') {
            inv.estadoLocal = 'Pendiente';
        }
        this.onFieldChange(inv);
    }

    onCodigoContableChange(inv: any) {
        if (inv.codigoContable) {
            inv.estadoLocal = 'Conciliado';
        }
        this.onFieldChange(inv);
    }

    async onFieldChange(inv: any) {
        try {
            if (inv.isEgreso) {
                await fetch(API_URL + `/api/finance/egresos/${inv.id}/metadata`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        banco: inv.banco,
                        codigoContable: inv.codigoContable
                    })
                });
                this.audit.log(`Actualizó metadata de Egreso ID: ${inv.id}`, 'Finanzas', `Banco: ${inv.banco} | Código Contable: ${inv.codigoContable}`);
                return;
            }

            await fetch(API_URL + `/api/finance/invoices/${inv.localId}/metadata`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    tipoMovimiento: inv.tipoMovimiento,
                    comision: inv.comision,
                    depositoSalida: inv.depositoSalida,
                    banco: inv.banco,
                    cuentaDebito: inv.cuentaDebito,
                    cuentaCredito: inv.cuentaCredito,
                    codigoContable: inv.codigoContable,
                    estadoLocal: inv.estadoLocal
                })
            });
            this.audit.log(`Actualizó metadata de Factura ID: ${inv.WHMCS_InvoiceID}`, 'Finanzas', `Banco: ${inv.banco} | Estado Local: ${inv.estadoLocal}`);
        } catch (error) {
            console.error('Error updating metadata:', error);
            this.notification.error('Error al guardar los cambios');
        }
    }

    getEmptyEgreso() {
        const today = new Date();
        const tzOffset = today.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().split('T')[0];

        return {
            fecha: localISOTime,
            monto: 0,
            banco: 'BCP',
            tipoEgreso: 'MANUAL',
            comercio: '',
            categoria: 'Otros',
            referencia: '',
            origen: 'MANUAL',
            observacion: '',
            codigoContable: ''
        };
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadAll();
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadAll();
        }
    }

    changePageSize(event: any) {
        this.pageSize = event.target.value;
        this.currentPage = 1;
        this.loadAll();
    }

    get effectivePageSize(): number {
        return this.pageSize === 'All' ? 9999 : parseInt(this.pageSize) || 25;
    }

    abrirNuevoModal() {
        this.nuevoEgreso = this.getEmptyEgreso();
        this.showModal = true;
    }

    cerrarModal() {
        this.showModal = false;
    }

    async guardarEgreso() {
        if (this.nuevoEgreso.monto <= 0) {
            this.notification.warning('El monto del egreso debe ser mayor a 0');
            return;
        }
        try {
            await fetch(API_URL + '/api/finance/egresos', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(this.nuevoEgreso)
            });
            this.audit.log(`Registró nuevo Egreso Manual: S/ ${this.nuevoEgreso.monto}`, 'Finanzas', `Comercio: ${this.nuevoEgreso.comercio} | Categoría: ${this.nuevoEgreso.categoria}`);
            this.notification.success('Egreso guardado correctamente.');
            this.cerrarModal();
            this.loadAll();
        } catch (error) {
            console.error('Error saving egreso:', error);
            this.notification.error('Error al guardar el egreso');
        }
    }

    async eliminarEgreso(id: number) {
        if (!await this.notification.confirm('¿Está seguro de eliminar este egreso?', 'Confirmar Eliminación')) return;
        try {
            const response = await fetch(API_URL + `/api/finance/egresos/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (response.ok) {
                this.audit.log(`Eliminó Egreso ID: ${id}`, 'Finanzas');
                this.notification.success('Egreso eliminado.');
                this.loadAll();
            } else {
                this.notification.error('Error al intentar eliminar el egreso.');
            }
        } catch (error) {
            console.error('Error deleting egreso:', error);
            this.notification.error('Error al eliminar');
        }
    }

    buscarCuentaDebitoPorBanco(banco: string): string {
        if (!banco || !this.debitAccounts.length) return '';
        const bancoLower = banco.toLowerCase().trim();

        const exactMatch = this.debitAccounts.find(cd => (cd.name || '').toLowerCase() === bancoLower);
        if (exactMatch) return exactMatch.name;

        const cuenta = this.debitAccounts.find(cd => {
            const nombre = (cd.name || '').toLowerCase();

            if (bancoLower.includes('bcp') || bancoLower.includes('crédito') || bancoLower.includes('credito') || bancoLower.includes('yape')) {
                return nombre.includes('bcp') || nombre.includes('crédito') || nombre.includes('credito') || nombre.includes('banco de');
            }
            if (bancoLower.includes('bbva') || bancoLower.includes('continental')) {
                return nombre.includes('bbva') || nombre.includes('continental');
            }
            if (bancoLower.includes('interbank') || bancoLower.includes('plin')) {
                return nombre.includes('interbank');
            }
            if (bancoLower.includes('izipay') || bancoLower.includes('caja')) {
                return nombre.includes('izipay') || nombre.includes('caja');
            }
            return nombre.includes(bancoLower);
        });
        return cuenta ? cuenta.name : '';
    }

    async autoEscanearPDF(item: any, invoiceId: string) {
        item.isScanning = true;
        try {
            const res = await fetch(API_URL + `/api/finance/invoices/${invoiceId}/pdf-info`, {
                headers: getAuthHeaders()
            });
            const resp = await res.json();
            if (resp.success && resp.data) {
                if (resp.data.banco) item.banco = resp.data.banco;
                if (item.banco && !item.cuentaDebito) {
                    item.cuentaDebito = this.buscarCuentaDebitoPorBanco(item.banco);
                }
                if (item.banco || item.cuentaDebito) {
                    this.onFieldChange(item);
                }
            }
        } catch (error) {
            console.error('Error scanning PDF:', error);
        } finally {
            item.isScanning = false;
            this.cdr.detectChanges();
        }
    }

    async openInvoiceDetail(invoiceId: number) {
        this.loadingInvoice = true;
        this.invoiceDetail = null;
        this.showInvoiceModal = true;
        try {
            const res = await fetch(API_URL + `/api/whmcs/invoice/${invoiceId}`, {
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.invoiceDetail = data.invoice;
            } else {
                this.notification.error('No se pudo cargar la factura seleccionada.');
                this.showInvoiceModal = false;
            }
        } catch (error) {
            console.error('Error loading invoice detail:', error);
            this.notification.error('Error al cargar los detalles de la factura');
            this.showInvoiceModal = false;
        } finally {
            this.loadingInvoice = false;
            this.cdr.detectChanges();
        }
    }

    closeInvoiceModal() {
        this.showInvoiceModal = false;
        this.invoiceDetail = null;
    }

    downloadInvoicePdf(invoiceId: number) {
        const url = `${API_URL}/api/whmcs/invoice/${invoiceId}/pdf`;
        const link = document.createElement('a');
        link.href = url;
        link.target = '_self';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    getClientParts(concepto: string): { empresa: string; nombre: string; servicio: string } {
        if (!concepto) return { empresa: '', nombre: 'Sin datos', servicio: '' };
        const lines = concepto.split('\n');
        if (lines.length >= 3) {
            return { empresa: lines[0], nombre: lines[1], servicio: lines.slice(2).join(' ') };
        } else if (lines.length === 2) {
            return { empresa: '', nombre: lines[0], servicio: lines[1] };
        }
        return { empresa: '', nombre: lines[0], servicio: '' };
    }
}
