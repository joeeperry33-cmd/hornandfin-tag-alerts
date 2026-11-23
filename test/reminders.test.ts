import { describe, expect, it } from 'vitest';
import { canText, daysBetween, deadlineProblem, dueReminders, reminderSms, reminderSubject, wantsReminder, type Deadline } from '../src/reminders';
import type { Subscriber } from '../src/types';

const d = (over: Partial<Deadline> = {}): Deadline => ({
  id: 'co-2027-primary-close', state: 'CO', species: 'elk,deer', kind: 'apply_close', date: '2027-04-07', time_note: '8 p.m. MT',
  title: 'Colorado big game draw applications close', link_url: 'https://cpw.state.co.us/hunting/big-game', source: 'CPW brochure',
  verified_at: '2026-11-23', active: 1, ...over,
});
const sub = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 's1', email: 'a@example.com', phone: '+15305550123', sms_consent_at: '2026-01-01', tier: 'free', states: 'CO,WY', species: 'elk',
  verified_at: '2026-01-01', verify_token: 'v', manage_token: 'm', stripe_customer: null, stripe_sub: null, sms_stopped: 0,
  unsubscribed_at: null, created_at: '2026-01-01', deadline_reminders: 1, ...over,
});

describe('deadline reminders', () => {
  it('counts days across months', () => {
    expect(daysBetween('2027-03-31', '2027-04-07')).toBe(7);
  });
  it('sends 7 days and 1 day before a close, never other days', () => {
    expect(dueReminders([d()], '2027-03-31').map((r) => r.offset)).toEqual([7]);
    expect(dueReminders([d()], '2027-04-06').map((r) => r.offset)).toEqual([1]);
    expect(dueReminders([d()], '2027-04-05')).toEqual([]);
    expect(dueReminders([d({ active: 0 })], '2027-04-06')).toEqual([]);
  });
  it('sends results reminders the day of', () => {
    expect(dueReminders([d({ kind: 'results', date: '2027-05-28' })], '2027-05-28').map((r) => r.offset)).toEqual([0]);
  });
  it('matches state and species, and honors the off switch', () => {
    expect(wantsReminder(sub(), d())).toBe(true);
    expect(wantsReminder(sub({ states: 'WY' }), d())).toBe(false);
    expect(wantsReminder(sub({ species: 'turkey' }), d())).toBe(false);
    expect(wantsReminder(sub({ species: 'turkey' }), d({ species: null }))).toBe(true);
    expect(wantsReminder(sub({ deadline_reminders: 0 }), d())).toBe(false);
    expect(wantsReminder(sub({ unsubscribed_at: '2026-02-01' }), d())).toBe(false);
  });
  it('texts only the day before a close, with consent', () => {
    expect(canText(sub(), { deadline: d(), offset: 1 })).toBe(true);
    expect(canText(sub(), { deadline: d(), offset: 7 })).toBe(false);
    expect(canText(sub({ sms_stopped: 1 }), { deadline: d(), offset: 1 })).toBe(false);
    expect(canText(sub({ sms_consent_at: null }), { deadline: d(), offset: 1 })).toBe(false);
    expect(reminderSms({ deadline: d(), offset: 1 })).toContain('tomorrow');
    expect(reminderSms({ deadline: d(), offset: 1 })).toContain('STOP');
  });
  it('writes a clear subject', () => {
    expect(reminderSubject([{ deadline: d(), offset: 7 }])).toBe('Colorado big game draw applications close in 7 days');
    expect(reminderSubject([{ deadline: d(), offset: 1 }, { deadline: d({ id: 'x' }), offset: 0 }])).toContain('2 hunting deadlines');
  });
  it('refuses unverified or malformed deadlines', () => {
    expect(deadlineProblem(d())).toBeNull();
    expect(deadlineProblem(d({ source: '' }))).toContain('source');
    expect(deadlineProblem(d({ link_url: 'http://x' }))).toContain('https');
    expect(deadlineProblem(d({ date: '4/7/2027' }))).toContain('YYYY');
    expect(deadlineProblem(d({ state: 'XX' }))).toContain('state');
  });
});
