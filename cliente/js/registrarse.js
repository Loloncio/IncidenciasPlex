const { createApp } = Vue;

createApp({
    data() {
        return {
            usuario: '',
            password: '',
            passwordConfirm: '',
            error: '',
            submitting: false,
        };
    },
    methods: {
        async onSubmit() {
            this.error = '';

            if (this.password !== this.passwordConfirm) {
                this.error = 'Las contraseñas no coinciden';
                return;
            }

            this.submitting = true;
            try {
                const response = await fetch('/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: this.usuario, password: this.password }),
                });
                const result = await response.json();

                if (!response.ok) {
                    this.error = result.error || 'Error al crear la cuenta';
                    return;
                }

                // Cuenta creada: iniciamos sesión automáticamente para no pedir los datos dos veces.
                const loginResponse = await fetch('/log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: this.usuario, password: this.password }),
                });
                window.location.href = loginResponse.ok ? '/mis-solicitudes' : '/login';
            } catch (error) {
                this.error = 'Error en la conexión al servidor';
            } finally {
                this.submitting = false;
            }
        },
    },
}).mount('#app');
