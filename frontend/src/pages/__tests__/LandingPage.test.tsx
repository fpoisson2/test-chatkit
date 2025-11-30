import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter, useNavigate } from "react-router-dom";
import LandingPage from "../LandingPage";
import { describe, it, expect, vi } from "vitest";

// Mocking the navigate function
const mockedNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

describe("LandingPage", () => {
  it("renders the landing page with main sections", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    // Header
    expect(screen.getAllByText("EDxo").length).toBeGreaterThan(0);
    expect(screen.getByText("Connexion")).toBeInTheDocument();

    // Hero
    expect(
      screen.getByText("Créez des assistants IA pédagogiques intelligents")
    ).toBeInTheDocument();
    expect(screen.getByText(/Démarrer maintenant/i)).toBeInTheDocument();

    // Features
    expect(screen.getByText("Pourquoi choisir EDxo ?")).toBeInTheDocument();
    expect(screen.getByText("Conçu pour l'éducation")).toBeInTheDocument();
    expect(screen.getByText("Workflow Builder Visuel")).toBeInTheDocument();
    expect(screen.getByText("IA Multi-modèles")).toBeInTheDocument();

    // Architecture
    expect(screen.getByText("Architecture Moderne")).toBeInTheDocument();
    expect(screen.getByText(/FastAPI/i)).toBeInTheDocument();
    expect(screen.getByText(/React 18/i)).toBeInTheDocument();
  });

  it("navigates to login page when clicking on 'Connexion'", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const loginButton = screen.getByText("Connexion");
    fireEvent.click(loginButton);

    expect(mockedNavigate).toHaveBeenCalledWith("/login");
  });

  it("navigates to login page when clicking on 'Démarrer maintenant'", () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    const startButton = screen.getByText(/Démarrer maintenant/i);
    fireEvent.click(startButton);

    expect(mockedNavigate).toHaveBeenCalledWith("/login");
  });
});
