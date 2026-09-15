const { createApp } = Vue;

createApp({
    data() {
        return {
            usuario: '',
            password: '',
            recordar: false,
            error: false,
            submitting: false,
        };
    },
    methods: {
        async onSubmit() {
            this.error = false;
            this.submitting = true;

            const params = new URLSearchParams(window.location.search);
            const nextUrl = params.get('next');

            try {
                const response = await fetch('/log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: this.usuario, password: this.password, recordar: this.recordar }),
                });

                if (response.ok) {
                    const result = await response.json();
                    // Si venimos de una redirección explícita (p.ej. /consultas sin sesión) respetamos
                    // esa URL; si no, cada rol tiene su página de aterrizaje por defecto.
                    window.location.href = nextUrl || (result.rol === 'admin' ? '/consultas' : '/mis-solicitudes');
                } else {
                    this.error = true;
                }
            } catch (error) {
                console.error('Error en el login:', error);
                this.error = true;
            } finally {
                this.submitting = false;
            }
        },
    },
}).mount('#app');
