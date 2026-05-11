import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { NotificationComponent } from '../shared/notification.component';

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, NotificationComponent],
    templateUrl: './layout.html',
    styleUrl: './layout.css'
})
export class LayoutComponent {
    isSidebarCollapsed = false;
    isMobileMenuOpen = false;
    currentUser: any = null;

    constructor(private authService: AuthService, private router: Router) {
        this.authService.currentUser.subscribe(user => {
            this.currentUser = user;
        });
    }

    logout(event: Event) {
        event.preventDefault();
        this.authService.logout();
    }

    hasAccess(section: string): boolean {
        if (!this.currentUser) return false;
        const role = this.currentUser.rol?.toUpperCase();
        if (role === 'SUPER_ADMIN') return true;

        const permissions = this.currentUser.permissions || {};
        if (section === 'dashboard' && permissions[section] === undefined) return true;

        return !!permissions[section];
    }

    get isSuperAdmin(): boolean {
        return this.currentUser?.rol?.toUpperCase() === 'SUPER_ADMIN';
    }

    get userName(): string {
        if (!this.currentUser) return 'Usuario';
        return this.currentUser.fullName || this.currentUser.email.split('@')[0];
    }

    toggleSidebar() {
        if (window.innerWidth <= 768) {
            this.isMobileMenuOpen = !this.isMobileMenuOpen;
        } else {
            this.isSidebarCollapsed = !this.isSidebarCollapsed;
        }
    }

    closeMobileMenu() {
        if (window.innerWidth <= 768) {
            this.isMobileMenuOpen = false;
        }
    }
}
