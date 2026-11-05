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
});
