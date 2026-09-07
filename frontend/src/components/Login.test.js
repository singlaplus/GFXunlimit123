import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import Login from "./Login";

jest.mock("axios");

describe("Login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REACT_APP_API_BASE_URL;
    window.alert = jest.fn();
  });

  it("submits the login identifier so users can sign in with either email or username", async () => {
    axios.post.mockResolvedValue({
      data: {
        token: "demo-token",
        username: "admin",
        userId: 1,
        role: "admin"
      }
    });

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: "admin" }
    });
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: "secret" }
    });
    fireEvent.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        "http://localhost:5000/login",
        expect.objectContaining({
          identifier: "admin",
          password: "secret"
        })
      );
    });
  });

  it("submits the form when Enter is pressed in the password field", async () => {
    axios.post.mockResolvedValue({
      data: {
        token: "demo-token",
        username: "admin",
        userId: 1,
        role: "admin"
      }
    });

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText(/email or username/i), {
      target: { value: "admin" }
    });
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: "secret" }
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/password/i), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        "http://localhost:5000/login",
        expect.objectContaining({
          identifier: "admin",
          password: "secret"
        })
      );
    });
  });
});
