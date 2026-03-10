import {
  LayoutDashboard,
  Network,
  Settings,
} from 'lucide-react'

import Dashboard from '../pages/Dashboard'
import Workflows from '../pages/Workflows'
import SettingsPage from '../pages/Settings'

export const coreRoutes = [
  {
    id: 'dashboard',
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    component: Dashboard,
    getProps: ({ status, loading }) => ({ status, loading }),
    sidebar: true,
  },
  {
    id: 'workflows',
    path: '/workflows',
    label: 'Workflows',
    icon: Network,
    component: Workflows,
    getProps: () => ({}),
    sidebar: true,
    order: 5,
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'Settings',
    icon: Settings,
    component: SettingsPage,
    getProps: () => ({}),
    sidebar: true,
    order: 99,
  },
]

export const coreExternalLinks = []
