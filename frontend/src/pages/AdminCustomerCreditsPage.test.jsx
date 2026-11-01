import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminCustomerCreditsPage from "./AdminCustomerCreditsPage";

jest.mock("axios");

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: [] });
});

test("shows a valid empty users response after loading completes", async () => {
  render(<AdminCustomerCreditsPage />);

  expect(await screen.findByText("No users found.")).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("rejects malformed customer-credit responses and retries only the GET", async () => {
  axios.get.mockResolvedValueOnce({ data: { users: [] } });
  render(<AdminCustomerCreditsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Customer credits response was invalid.");
  expect(screen.queryByText("No users found.")).not.toBeInTheDocument();

  axios.get.mockResolvedValueOnce({ data: [] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No users found.")).toBeInTheDocument();
  });
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(axios.delete).not.toHaveBeenCalled();
});
