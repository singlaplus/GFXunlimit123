import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminSubscribersPage from "./AdminSubscribersPage";

jest.mock("axios");

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockImplementation(() => Promise.resolve({ data: [] }));
});

test("shows the valid empty subscriber state after loading succeeds", async () => {
  render(<AdminSubscribersPage />);

  expect(await screen.findByText("No subscribed customers found.")).toBeInTheDocument();
  expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/custom-subscriptions"))).toHaveLength(1);
});

test("shows subscriber load failures and retries only the essential GET", async () => {
  axios.get.mockImplementation((url) => (
    url.includes("/admin/custom-subscriptions")
      ? Promise.reject(new Error("Unavailable"))
      : Promise.resolve({ data: [] })
  ));
  render(<AdminSubscribersPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(screen.queryByText("No subscribed customers found.")).not.toBeInTheDocument();

  axios.get.mockImplementation(() => Promise.resolve({ data: [] }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No subscribed customers found.")).toBeInTheDocument();
  });
  expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/custom-subscriptions"))).toHaveLength(2);
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(axios.delete).not.toHaveBeenCalled();
});

test("rejects malformed subscriber responses instead of showing an empty state", async () => {
  axios.get.mockImplementation((url) => (
    url.includes("/admin/custom-subscriptions")
      ? Promise.resolve({ data: { subscribers: [] } })
      : Promise.resolve({ data: [] })
  ));
  render(<AdminSubscribersPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Subscribers response was invalid.");
  expect(screen.queryByText("No subscribed customers found.")).not.toBeInTheDocument();
});
