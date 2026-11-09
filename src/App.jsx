import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HtmlPage from './HtmlPage'

import loginHtml        from './pages/login.html?raw'
import staffHtml        from './pages/staff.html?raw'
import adminHtml        from './pages/admin.html?raw'
import vcHtml           from './pages/vice-chancellor.html?raw'
import hodHtml          from './pages/head-of-department.html?raw'
import deanHtml         from './pages/faculty-dean.html?raw'
import dashboardHtml    from './pages/dashboard2.html?raw'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                    element={<Navigate to="/login" replace />} />
        <Route path="/login"               element={<HtmlPage html={loginHtml}     title="AAUA MEMO • Sign In" />} />
        <Route path="/staff"               element={<HtmlPage html={staffHtml}     title="AAUA MEMO — Staff Portal" />} />
        <Route path="/Admin"               element={<HtmlPage html={adminHtml}     title="AAUA MEMO — Admin" />} />
        <Route path="/vice-chancellor"     element={<HtmlPage html={vcHtml}        title="AAUA MEMO — Vice Chancellor" />} />
        <Route path="/head-of-department"  element={<HtmlPage html={hodHtml}       title="AAUA MEMO — HOD Portal" />} />
        <Route path="/faculty-dean"        element={<HtmlPage html={deanHtml}      title="AAUA MEMO — Faculty Dean" />} />
        <Route path="/dashboard"           element={<HtmlPage html={dashboardHtml} title="AAUA MEMO — Dashboard" />} />
        <Route path="*"                    element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
