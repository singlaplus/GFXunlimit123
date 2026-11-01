import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AdminEmailScheduled from './AdminEmailScheduled';

jest.mock('axios');

beforeEach(() => {
  axios.get.mockResolvedValue({ data: [] });
});

test('shows a set button for the scheduled time picker', async () => {
  render(<AdminEmailScheduled />);

  expect(await screen.findByRole('button', { name: /set time/i })).toBeInTheDocument();
});

test('does not show an empty schedule state before the initial GET succeeds', async () => {
  let resolveSchedules;
  axios.get.mockReturnValueOnce(new Promise((resolve) => {
    resolveSchedules = resolve;
  }));
  render(<AdminEmailScheduled />);

  expect(screen.getByRole('status')).toHaveTextContent('Loading scheduled emails...');
  expect(screen.queryByText('No scheduled emails yet.')).not.toBeInTheDocument();

  await act(async () => {
    resolveSchedules({ data: [] });
  });
  expect(screen.getByText('No scheduled emails yet.')).toBeInTheDocument();
});

test('shows scheduled email load errors and retries only the GET', async () => {
  axios.get.mockRejectedValueOnce(new Error('Unavailable'));
  render(<AdminEmailScheduled />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  expect(screen.queryByText('No scheduled emails yet.')).not.toBeInTheDocument();

  axios.get.mockResolvedValueOnce({ data: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No scheduled emails yet.')).toBeInTheDocument();
  });
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(axios.delete).not.toHaveBeenCalled();
});

test('rejects malformed scheduled email responses instead of showing an empty state', async () => {
  axios.get.mockResolvedValueOnce({ data: { schedules: [] } });
  render(<AdminEmailScheduled />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Scheduled emails response was invalid.');
  expect(screen.queryByText('No scheduled emails yet.')).not.toBeInTheDocument();
});
