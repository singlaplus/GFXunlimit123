import { render, screen } from "@testing-library/react";
import LoadingMessage from "./LoadingMessage";

it("shows a local search status while search results are loading", () => {
  render(<LoadingMessage loading darkMode={false} search="F" />);

  expect(screen.getByRole("status")).toHaveTextContent("Searching images...");
});
