// src/main.jsx
import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

const StrategyBuilder = lazy(() => import("./pages/StrategyBuilder"));
const Home = lazy(() => import("./pages/Home"));
const Sentiment = lazy(() => import("./pages/Sentiment"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Journal = lazy(() => import("./pages/Journal"));
const Intelligence = lazy(() => import("./pages/Intelligence"));

const RouteNotFound = () => (
  <div className="p-6 text-white">
    <h2 className="text-xl mb-2">Route not found</h2>
    <div className="text-neutral">The requested page does not exist.</div>
  </div>
);

const Fallback = () => <div className="p-6 text-neutral">Loading...</div>;

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Suspense fallback={<Fallback />}><Home /></Suspense>} />
          <Route path="sentiment" element={<Suspense fallback={<Fallback />}><Sentiment /></Suspense>} />
          <Route path="watchlist" element={<Suspense fallback={<Fallback />}><Watchlist /></Suspense>} />
          <Route path="backtest" element={<Suspense fallback={<Fallback />}><StrategyBuilder /></Suspense>} />
          <Route path="journal" element={<Suspense fallback={<Fallback />}><Journal /></Suspense>} />
          <Route path="intelligence" element={<Suspense fallback={<Fallback />}><Intelligence /></Suspense>} />
          <Route path="*" element={<RouteNotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);
