import React from 'react';
import { render, screen } from '@testing-library/react';
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
