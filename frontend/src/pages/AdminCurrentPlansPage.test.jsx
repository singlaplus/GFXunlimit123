import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminCurrentPlansPage from "./AdminCurrentPlansPage";

jest.mock("axios");

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: [] });
});

test("does not show zero plan counts before the initial request succeeds", async () => {
  let resolvePlans;
  axios.get.mockReturnValueOnce(new Promise((resolve) => {
    resolvePlans = resolve;
  }));
  render(<AdminCurrentPlansPage />);

  expect(screen.getByText("Loading current plans...")).toBeInTheDocument();
  expect(document.querySelector(".current-plans-summary")).toHaveTextContent("-");
  expect(screen.queryByText("No current plans found.")).not.toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolvePlans({ data: [] });
  });
  expect(screen.getByText("No current plans found.")).toBeInTheDocument();
  expect(document.querySelector(".current-plans-summary")).toHaveTextContent("0");
});

test("shows current-plan load failures and retries only the GET", async () => {
  axios.get.mockRejectedValueOnce(new Error("Unavailable"));
  render(<AdminCurrentPlansPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(screen.queryByText("No current plans found.")).not.toBeInTheDocument();
  expect(document.querySelector(".current-plans-summary")).toHaveTextContent("-");

  axios.get.mockResolvedValueOnce({ data: [] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No current plans found.")).toBeInTheDocument();
  });
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(axios.delete).not.toHaveBeenCalled();
});

test("rejects malformed current-plan responses instead of showing an empty state", async () => {
  axios.get.mockResolvedValueOnce({ data: { plans: [] } });
  render(<AdminCurrentPlansPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Current plans response was invalid.");
  expect(screen.queryByText("No current plans found.")).not.toBeInTheDocument();
});
