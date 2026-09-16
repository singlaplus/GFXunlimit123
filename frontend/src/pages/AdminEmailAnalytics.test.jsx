import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import axios from 'axios';
import AdminEmailAnalytics from './AdminEmailAnalytics';

jest.mock('axios');

describe('AdminEmailAnalytics', () => {
  it('renders premium summary cards and range presets', async () => {
    axios.get.mockResolvedValue({
      data: {
        totals: { sent: 12, delivered: 10, opened: 6, clicked: 2, total: 12 },
        daily: [],
        range: '7d'
      }
    });

    render(<AdminEmailAnalytics />);

    expect(await screen.findByText('Email Analytics')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Opened').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Clicked').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /last 7 days/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom/i })).toBeInTheDocument();
  });

  it('shows a metric selector for the connected trend chart', async () => {
    axios.get.mockResolvedValue({
      data: {
        totals: { sent: 4, delivered: 2, opened: 1, clicked: 0, total: 4 },
        daily: [{ day: '2026-07-20', sent_count: 2, delivered_count: 1, opened_count: 0, clicked_count: 0 }, { day: '2026-07-21', sent_count: 4, delivered_count: 2, opened_count: 1, clicked_count: 0 }],
        range: '7d'
      }
    });

    render(<AdminEmailAnalytics />);

    expect(await screen.findByLabelText(/trend metric/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/trend metric/i), { target: { value: 'delivered' } });
    expect(screen.getByText('Delivered trend')).toBeInTheDocument();
  });

  it('shows a clear error when analytics loading fails', async () => {
    axios.get.mockRejectedValue(new Error('network down'));

    render(<AdminEmailAnalytics />);

    expect(await screen.findByText('Unable to load analytics data right now.')).toBeInTheDocument();
  });

  it('exports CSV for the current email analytics range', async () => {
    localStorage.setItem('token', 'test-token');
    axios.get.mockResolvedValue({
      data: {
        totals: { sent: 3, delivered: 2, opened: 1, clicked: 0, total: 3 },
        daily: [],
        range: '7d'
      }
    });

    render(<AdminEmailAnalytics />);

    expect(await screen.findByText('Email Analytics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/admin/email/analytics/export?range=7d'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  });
});
