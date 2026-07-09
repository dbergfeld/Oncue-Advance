import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UserProvider } from "./context/UserContext";
import { ShowProvider } from "./context/ShowContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <UserProvider>
        <ShowProvider>
          <App />
        </ShowProvider>
      </UserProvider>
    </BrowserRouter>
  </React.StrictMode>
);
