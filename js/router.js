// ============================================
// TRANSFORMLAB - Router v4.0
// Lightweight client-side view router
// ============================================

const Router = {

    // Available views and their metadata
    VIEWS: {
        dashboard:  { label: 'Dashboard',      icon: '📊', requiresData: true  },
        checkin:    { label: 'Check-in',        icon: '📋', requiresData: true  },
        nutrition:  { label: 'Nutrición',       icon: '🥗', requiresData: true  },
        training:   { label: 'Entrenamiento',   icon: '🏋️', requiresData: true  },
        milestones: { label: 'Hitos',           icon: '🏆', requiresData: true  },
        body:       { label: 'Cuerpo',          icon: '🫀', requiresData: true  }
    },

    _currentView: 'dashboard',

    /**
     * Initialize the router:
     * - Restore last active view from localStorage
     * - Attach sidebar click handlers
     */
    init() {
        const saved = localStorage.getItem('transformlab_activeView');
        const initial = (saved && this.VIEWS[saved]) ? saved : 'dashboard';
        this.navigateTo(initial, false);
        this._attachSidebarHandlers();
    },

    /**
     * Navigate to a named view.
     *
     * @param {string}  viewId   - Key from VIEWS
     * @param {boolean} [save]   - Whether to persist the choice (default true)
     */
    navigateTo(viewId, save = true) {
        if (!this.VIEWS[viewId]) {
            console.warn('Router: unknown view', viewId);
            return;
        }

        // Hide all views
        document.querySelectorAll('.app-view').forEach(el => {
            el.classList.remove('active');
        });

        // Show target view
        const target = document.getElementById(`view-${viewId}`);
        if (target) {
            target.classList.add('active');
        }

        // Update sidebar active state
        document.querySelectorAll('.sidebar-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === viewId);
        });

        const previous = this._currentView;
        this._currentView = viewId;

        // Persist
        if (save) {
            localStorage.setItem('transformlab_activeView', viewId);
        }

        // Show/hide the main nav bar (only relevant for dashboard)
        const navBar = document.querySelector('.nav-bar');
        if (navBar) {
            navBar.style.display = (viewId === 'dashboard') ? '' : 'none';
        }

        // Dispatch custom event for modules to react
        window.dispatchEvent(new CustomEvent('viewchange', {
            detail: { from: previous, to: viewId }
        }));

        console.log(`🧭 Navigated to: ${viewId}`);
    },

    /** Return the currently active view id */
    current() {
        return this._currentView;
    },

    _attachSidebarHandlers() {
        document.querySelectorAll('.sidebar-nav-item').forEach(el => {
            el.addEventListener('click', () => {
                const viewId = el.dataset.view;
                if (viewId) this.navigateTo(viewId);
            });
        });

        // Mobile: hamburger toggle
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('appSidebar');
        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
            // Close sidebar when a nav item is tapped on mobile
            document.querySelectorAll('.sidebar-nav-item').forEach(el => {
                el.addEventListener('click', () => sidebar.classList.remove('open'));
            });
        }
    }
};

if (typeof window !== 'undefined') {
    window.Router = Router;
}
