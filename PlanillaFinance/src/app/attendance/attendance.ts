import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { API_URL, getAuthHeaders } from '../api-config';

@Component({
    selector: 'app-attendance',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './attendance.html',
    styleUrl: './attendance.css'
})

export class AttendanceComponent implements OnInit {

    today: Date = new Date();
    totalEmployees: number = 0;
    presentToday: number = 0;
    lateToday: number = 0;
    absentToday: number = 0;
    searchText: string = '';
    attendanceData: any[] = [];
    employees: any[] = [];
    displayedData: any[] = [];
    isModalOpen: boolean = false;
    selectedEmployee: any = null;
    selectedEmployeeHistory: any[] = [];
    isJustifyModalOpen: boolean = false;
    selectedEmployeeForJustify: any = null;
    justificationData = {
        reason: '',
        documentType: 'Certificado Médico'
    };

    isObservationModalOpen: boolean = false;
    selectedEmployeeForObservation: any = null;
    observationText: string = '';

    constructor() { }

    ngOnInit() {
        this.loadRealAttendance();
    }

    async loadRealAttendance() {
        try {
            const todayStr = new Date().toISOString().split('T')[0];
            const timestamp = new Date().getTime();

            const empRes = await fetch(`${API_URL}/api/empleados?t=${timestamp}`, { headers: getAuthHeaders() });

            if (empRes.ok) {
                this.employees = await empRes.json();
            }

            const logsRes = await fetch(`${API_URL}/api/attendance/logs?date=${todayStr}&t=${timestamp}`, { headers: getAuthHeaders() });

            if (logsRes.ok) {
                const logs = await logsRes.json();
                this.processRealLogs(logs);
            }
        } catch (error) {
            console.error('Error al cargar asistencia:', error);
        }
    }

    processRealLogs(logs: any[]) {
        const attendanceMap = new Map<number, any>();

        if (this.employees && this.employees.length > 0) {
            this.employees.forEach(empInfo => {
                if (empInfo.biometricId) {
                    attendanceMap.set(empInfo.biometricId, {
                        id: empInfo.id,
                        name: `${empInfo.nombre} ${empInfo.apellidos}`,
                        role: empInfo.cargo || 'Personal',
                        department: empInfo.departamento || '-',
                        clockIn: '-- : --',
                        clockOut: '-- : --',
                        status: 'Falta',
                        shift: `${empInfo.entryTime || '09:00'} - ${empInfo.exitTime || '18:00'}`,
                        observation: '',
                        rawEntry: null,
                        rawExit: null,
                        expectedEntry: empInfo.entryTime || '09:00',
                        punches: []
                    });
                }
            });
        }

        logs.forEach(log => {
            const userId = parseInt(log.USERID);
            if (isNaN(userId)) return;

            if (!attendanceMap.has(userId)) {
                const empInfo = this.employees.find(e => e.biometricId === userId);

                if (empInfo) {
                    attendanceMap.set(userId, {
                        id: empInfo.id,
                        name: `${empInfo.nombre} ${empInfo.apellidos}`,
                        role: empInfo.cargo || 'Personal',
                        department: empInfo.departamento || '-',
                        clockIn: '-- : --',
                        clockOut: '-- : --',
                        status: 'Falta',
                        shift: `${empInfo.entryTime || '09:00'} - ${empInfo.exitTime || '18:00'}`,
                        observation: '',
                        rawEntry: null,
                        rawExit: null,
                        expectedEntry: empInfo.entryTime || '09:00',
                        punches: []
                    });
                } else {
                    attendanceMap.set(userId, {
                        id: userId,
                        name: log.NOMBRE || `ID Desconocido (${userId})`,
                        role: '-',
                        department: '-',
                        clockIn: '-- : --',
                        clockOut: '-- : --',
                        status: 'Falta',
                        shift: '09:00 - 18:00',
                        observation: 'Sincronizado desde biométrico',
                        rawEntry: null,
                        rawExit: null,
                        expectedEntry: '09:00',
                        punches: []
                    });
                }
            }

            const emp = attendanceMap.get(userId);
            if (!emp) return;

            const checkTime = new Date(log.CHECKTIME);

            if (!emp.punches) {
                emp.punches = [];
            }
            emp.punches.push(checkTime);
        });

        const finalData = Array.from(attendanceMap.values()).map(emp => {
            if (emp.punches && emp.punches.length > 0) {
                emp.punches.sort((a: Date, b: Date) => a.getTime() - b.getTime());

                emp.rawEntry = emp.punches[0];
                emp.clockIn = emp.rawEntry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

                if (emp.punches.length > 1) {
                    const firstPunch = emp.punches[0];
                    const lastPunch = emp.punches[emp.punches.length - 1];
                    const diffMs = lastPunch.getTime() - firstPunch.getTime();
                    const diffMins = diffMs / (1000 * 60);

                    if (diffMins > 5) {
                        emp.rawExit = lastPunch;
                        emp.clockOut = emp.rawExit.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                    } else {
                        emp.clockOut = '-- : --';
                    }
                }
            }

            if (emp.rawEntry) {
                const [expH, expM] = emp.expectedEntry.split(':').map(Number);
                const entryH = emp.rawEntry.getHours();
                const entryM = emp.rawEntry.getMinutes();

                if (entryH < expH || (entryH === expH && entryM <= expM + 10)) {
                    emp.status = 'Puntual';
                } else {
                    emp.status = 'Tarde';
                }
            }
            emp.totalHours = this.calculateWorkedHours(emp.clockIn, emp.clockOut);
            emp.rawTotalHours = this.calculateRawHours(emp.clockIn, emp.clockOut);
            return emp;
        });

        finalData.sort((a, b) => {
            const aIsAbsent = a.status === 'Falta' && a.clockIn === '-- : --';
            const bIsAbsent = b.status === 'Falta' && b.clockIn === '-- : --';
            if (aIsAbsent && !bIsAbsent) return 1;
            if (!aIsAbsent && bIsAbsent) return -1;
            return 0;
        });

        this.attendanceData = finalData;
        this.calculateStats(this.attendanceData);
        this.filterData();
    }

    convertToMinutes(time: string): number {
        if (time === '-- : --') return 0;
        const [hourMin, period] = time.split(' ');
        let [hours, minutes] = hourMin.split(':').map(Number);
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return (hours * 60) + minutes;
    }

    calculateRawHours(clockIn: string, clockOut: string): string {
        if (clockIn === '-- : --' || clockOut === '-- : --') return '0.0';
        const inMinutes = this.convertToMinutes(clockIn);
        const outMinutes = this.convertToMinutes(clockOut);
        let workedMinutes = outMinutes - inMinutes;
        if (workedMinutes < 0) workedMinutes = 0;
        return (workedMinutes / 60).toFixed(1);
    }

    calculateWorkedHours(clockIn: string, clockOut: string): string {
        if (clockIn === '-- : --' || clockOut === '-- : --') return '0h 0m';
        const inMinutes = this.convertToMinutes(clockIn);
        const outMinutes = this.convertToMinutes(clockOut);
        let workedMinutes = outMinutes - inMinutes;
        workedMinutes -= 60; // Restar almuerzo
        if (workedMinutes < 0) workedMinutes = 0;
        const hours = Math.floor(workedMinutes / 60);
        const minutes = workedMinutes % 60;
        return `${hours}h ${minutes}m`;
    }

    async openEmployeeModal(emp: any) {
        this.selectedEmployee = emp;
        this.selectedEmployeeHistory = [];
        this.isModalOpen = true;

        try {
            const res = await fetch(`${API_URL}/api/attendance/history/${emp.id}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const allHistory = await res.json();

                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                this.selectedEmployeeHistory = allHistory.filter((record: any) => {
                    const recDate = new Date(record.date);
                    return recDate.getMonth() === currentMonth && recDate.getFullYear() === currentYear;
                }).map((record: any) => {
                    if (record.clockIn && record.clockIn !== '-- : --' && record.clockOut && record.clockOut !== '-- : --') {
                        try {
                            const inMin = this.convertToMinutes(record.clockIn);
                            const outMin = this.convertToMinutes(record.clockOut);

                            if (outMin - inMin <= 5) {
                                record.clockOut = '-- : --';
                                record.totalHours = '0h';
                            }
                        } catch (e) { }
                    }
                    return record;
                });
            }
        } catch (error) {
            console.error('Error al cargar historial:', error);
        }
    }

    closeModal() {
        this.isModalOpen = false;
        this.selectedEmployee = null;
        this.selectedEmployeeHistory = [];
    }

    openJustifyModal(emp: any) {
        this.selectedEmployeeForJustify = emp;
        this.justificationData = {
            reason: emp.justificationReason || '',
            documentType: emp.justificationType || 'Certificado Médico'
        };
        this.isJustifyModalOpen = true;
    }

    closeJustifyModal() {
        this.isJustifyModalOpen = false;
        this.selectedEmployeeForJustify = null;
        this.justificationData = { reason: '', documentType: 'Certificado Médico' };
    }

    submitJustification() {
        if (this.selectedEmployeeForJustify) {
            const emp = this.attendanceData.find(e => e.id === this.selectedEmployeeForJustify.id);
            if (emp) {
                emp.status = 'Justificado';
                emp.justificationReason = this.justificationData.reason;
                emp.justificationType = this.justificationData.documentType;
            }
            this.closeJustifyModal();
            this.calculateStats(this.attendanceData);
            this.filterData();
        }
    }

    exportEmployeeReport(emp: any) {
        const header = "Fecha,Empleado,Entrada,Salida,Total Horas,Estado\n";
        const row = `${new Date().toLocaleDateString()},${emp.name},${emp.clockIn},${emp.clockOut},${emp.totalHours},${emp.status}\n`;
        const blob = new Blob([header + row], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Reporte_Asistencia_${emp.name.replace(/\s+/g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    openObservationModal(emp: any) {
        this.selectedEmployeeForObservation = emp;
        this.observationText = emp.observation || '';
        this.isObservationModalOpen = true;
    }

    closeObservationModal() {
        this.isObservationModalOpen = false;
        this.selectedEmployeeForObservation = null;
        this.observationText = '';
    }

    saveObservation() {
        if (this.selectedEmployeeForObservation) {
            const emp = this.attendanceData.find(e => e.id === this.selectedEmployeeForObservation.id);
            if (emp) {
                emp.observation = this.observationText;
            }
            this.closeObservationModal();
        }
    }

    calculateStats(dataToProcess: any[]) {
        this.totalEmployees = dataToProcess.length > 0 ? dataToProcess.length : this.employees.length;
        this.presentToday = dataToProcess.filter(e => e.status === 'Puntual' || e.status === 'Tarde' || e.status === 'Justificado').length;
        this.lateToday = dataToProcess.filter(e => e.status === 'Tarde').length;
        this.absentToday = (this.employees ? this.employees.length : 0) - dataToProcess.length;
        if (this.absentToday < 0) this.absentToday = 0;
    }

    filterData() {
        if (!this.searchText) {
            this.displayedData = [...this.attendanceData];
        } else {
            const lowerQuery = this.searchText.toLowerCase();
            this.displayedData = this.attendanceData.filter(emp =>
                emp.name.toLowerCase().includes(lowerQuery) ||
                emp.role.toLowerCase().includes(lowerQuery) ||
                emp.department.toLowerCase().includes(lowerQuery)
            );
        }
    }

    getInitials(name: string): string {
        if (!name) return '??';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }
}