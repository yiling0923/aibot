// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('Login page', () => {
  it('shows the server message when the password is wrong, and lets the person try again', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/auth/me' ? json(401, {}) : json(401, { error: 'Wrong username or password.' }))));
    render(<Login />);
    await userEvent.type(screen.getByLabelText('Username'), 'luckypay');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password.');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows or hides the password, and warns when Caps Lock is on', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401, {})));
    render(<Login />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement; expect(pw.type).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: 'Show the password' })); expect(pw.type).toBe('text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide the password' })); expect(pw.type).toBe('password');
    expect(screen.queryByText('Caps Lock is on')).toBeNull();
    const ev = new KeyboardEvent('keyup', { key: 'a', bubbles: true, modifierCapsLock: true } as KeyboardEventInit);
    pw.dispatchEvent(ev); expect(await screen.findByText('Caps Lock is on')).toBeTruthy();
  });
});

describe('Login page language', () => {
  it('switches to Chinese and remembers it for the panel', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401, {})));
    localStorage.removeItem('panelLang'); render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy(); expect(localStorage.getItem('panelLang')).toBe('zh');
    localStorage.removeItem('panelLang');
  });
});
