// Componente de cabecera compartido, montado de forma independiente del Vue app
// propio de cada página (evita duplicar la lógica de sesión/logout en cada una).
(function () {
    const { createApp } = Vue;

    createApp({
        data() {
            return {
                session: { loggedin: false, username: null, rol: null },
            };
        },
        methods: {
            async loadSession() {
                try {
                    const response = await fetch('/api/session');
                    this.session = await response.json();
                } catch (error) {
                    console.error('No se pudo comprobar la sesión:', error);
                }
            },
            async logout() {
                await fetch('/logout', { method: 'POST' });
                window.location.href = '/login';
            },
        },
        mounted() {
            this.loadSession();
        },
    }).mount('#site-header-app');
})();
