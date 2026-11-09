/**
 * Canonical Seller App Modules & Permissions Dictionary
 *
 * Mapped to actual modules and operations available in ExtraHand Seller App.
 */

export interface PermissionDefinition {
  id: string;
  label: string;
  description: string;
}

export interface PermissionModule {
  id: string;
  name: string;
  description: string;
  icon: string;
  permissions: PermissionDefinition[];
}

export const SELLER_APP_MODULES: PermissionModule[] = [
  {
    id: 'dashboard',
    name: 'Dashboard and Analytics',
    description: 'Store overview, order counts and sales trend charts',
    icon: 'LayoutDashboard',
    permissions: [
      {
        id: 'dashboard:view',
        label: 'View Dashboard',
        description: 'Access home dashboard with live order counts and summaries',
      },
      {
        id: 'analytics:view',
        label: 'View Analytics',
        description: 'View sales trends, daily revenue graph, and order analytics',
      },
    ],
  },
  {
    id: 'orders',
    name: 'Orders',
    description: 'Order lifecycle from acceptance to handover to delivery partner',
    icon: 'ShoppingBag',
    permissions: [
      {
        id: 'orders:view',
        label: 'View Orders',
        description: 'View incoming, active, and past orders list and details',
      },
      {
        id: 'orders:accept',
        label: 'Accept Orders',
        description: 'Accept incoming customer orders',
      },
      {
        id: 'orders:pack',
        label: 'Pack Orders',
        description: 'Mark items prepared and pack orders for pickup',
      },
      {
        id: 'orders:handover',
        label: 'Handover to Delivery Partner',
        description: 'Scan and verify delivery partner handover QR code',
      },
      {
        id: 'orders:cancel',
        label: 'Cancel Orders',
        description: 'Reject or cancel orders when unable to fulfill',
      },
    ],
  },
  {
    id: 'products',
    name: 'Products and Catalogue',
    description: 'Products in store, details, and pricing',
    icon: 'Package',
    permissions: [
      {
        id: 'products:view',
        label: 'View Products',
        description: 'View store product catalogue listings and details',
      },
      {
        id: 'products:create',
        label: 'Add Products',
        description: 'Add new products to store from master catalogue',
      },
      {
        id: 'products:edit',
        label: 'Edit Product Details',
        description: 'Edit product specifications, description, and images',
      },
      {
        id: 'products:edit_price',
        label: 'Edit Product Prices',
        description: 'Modify product selling prices and discounts',
      },
      {
        id: 'products:delete',
        label: 'Delete Products',
        description: 'Remove or unlist products from store catalogue',
      },
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory and Stock',
    description: 'Stock availability, inventory counts, and threshold alerts',
    icon: 'Boxes',
    permissions: [
      {
        id: 'inventory:view',
        label: 'View Stock',
        description: 'View inventory counts and availability status',
      },
      {
        id: 'inventory:toggle_stock',
        label: 'Toggle Stock (In / Out of Stock)',
        description: 'Quickly mark items In Stock or Out of Stock',
      },
      {
        id: 'inventory:update_stock',
        label: 'Update Stock Quantities',
        description: 'Edit stock units, batches, and threshold alerts',
      },
    ],
  },
  {
    id: 'coupons',
    name: 'Coupons and Offers',
    description: 'Store promotional campaigns and customer discounts',
    icon: 'Percent',
    permissions: [
      {
        id: 'coupons:view',
        label: 'View Coupons',
        description: 'View active and scheduled coupons and discount campaigns',
      },
      {
        id: 'coupons:manage',
        label: 'Manage Coupons',
        description: 'Create, edit, toggle, or delete store coupons',
      },
    ],
  },
  {
    id: 'shop',
    name: 'Shop Management',
    description: 'Shop profile, operating hours, and store display',
    icon: 'Store',
    permissions: [
      {
        id: 'shop:view',
        label: 'View Shop Profile',
        description: 'View store details, address, and operating hours',
      },
      {
        id: 'shop:edit',
        label: 'Edit Shop Details',
        description: 'Update store description, banner, photo, and operating hours',
      },
    ],
  },
  {
    id: 'seasonal',
    name: 'Seasonal Products',
    description: 'Seasonal collections and festival special catalogues',
    icon: 'Sparkles',
    permissions: [
      {
        id: 'seasonal:view',
        label: 'View Seasonal Products',
        description: 'Browse seasonal and festival catalogue collections',
      },
      {
        id: 'seasonal:manage',
        label: 'Manage Seasonal Products',
        description: 'Add or configure seasonal products and listings',
      },
    ],
  },
  {
    id: 'custom_products',
    name: 'Custom Products',
    description: 'Custom product submission requests to platform admin',
    icon: 'FilePlus',
    permissions: [
      {
        id: 'custom_products:view',
        label: 'View Custom Product Requests',
        description: 'Check review status of submitted custom products',
      },
      {
        id: 'custom_products:create',
        label: 'Submit Custom Products',
        description: 'Submit new product requests not in master catalogue',
      },
    ],
  },
  {
    id: 'notifications',
    name: 'Notifications and Alerts',
    description: 'Order ringtone, popups, and notification history',
    icon: 'BellRing',
    permissions: [
      {
        id: 'notifications:view',
        label: 'View Notifications',
        description: 'View notification history and incoming order alerts',
      },
      {
        id: 'notifications:manage',
        label: 'Manage Alert Settings',
        description: 'Configure new-order sound volume, lockscreen popups, and ring settings',
      },
    ],
  },
  {
    id: 'payouts',
    name: 'Payouts and Transactions',
    description: 'Daily revenue, settlement ledger, and financial reports',
    icon: 'IndianRupee',
    permissions: [
      {
        id: 'finances:view_earnings',
        label: 'View Earnings',
        description: 'View daily earnings breakdown and settlement summaries',
      },
      {
        id: 'finances:view_ledger',
        label: 'View Ledger',
        description: 'View financial ledger transactions and deductions',
      },
    ],
  },
  {
    id: 'staff',
    name: 'Staff Management',
    description: 'Custom roles and staff member administration',
    icon: 'Users',
    permissions: [
      {
        id: 'staff:view',
        label: 'View Staff & Roles',
        description: 'View staff members, assigned roles, and permissions',
      },
      {
        id: 'staff:manage',
        label: 'Manage Staff & Roles',
        description: 'Create custom roles, add staff, change roles, and deactivate accounts',
      },
    ],
  },
  {
    id: 'store_settings',
    name: 'Store Settings',
    description: 'Store open/close toggle, prep buffers, and rush mode',
    icon: 'Clock',
    permissions: [
      {
        id: 'store_settings:toggle_status',
        label: 'Open / Close Store',
        description: 'Switch store status between Open and Closed manually',
      },
      {
        id: 'store_settings:manage_prep',
        label: 'Manage Preparation & Rush Mode',
        description: 'Configure order prep time buffers and busy mode',
      },
    ],
  },
];

/** Flattened array of all valid permission IDs */
export const ALL_PERMISSION_IDS: string[] = SELLER_APP_MODULES.flatMap((mod) =>
  mod.permissions.map((p) => p.id),
);

/** System default role presets offered to every store */
export const DEFAULT_SYSTEM_ROLES = [
  {
    name: 'Store Manager',
    description: 'Full operational access: orders, catalogue, stock, timings, and daily earnings (excluding bank payouts & store deletion)',
    permissions: [
      'dashboard:view',
      'analytics:view',
      'orders:view',
      'orders:accept',
      'orders:pack',
      'orders:handover',
      'orders:cancel',
      'products:view',
      'products:create',
      'products:edit',
      'products:edit_price',
      'inventory:view',
      'inventory:toggle_stock',
      'inventory:update_stock',
      'coupons:view',
      'shop:view',
      'shop:edit',
      'seasonal:view',
      'seasonal:manage',
      'custom_products:view',
      'custom_products:create',
      'notifications:view',
      'notifications:manage',
      'finances:view_earnings',
      'finances:view_ledger',
      'store_settings:toggle_status',
      'store_settings:manage_prep',
    ],
    isSystem: true,
  },
  {
    name: 'Order Helper / Packer',
    description: 'Order fulfillment & inventory management: accept orders, pack, verify handover QR, update stock counts, add/edit products, and toggle stock',
    permissions: [
      'dashboard:view',
      'orders:view',
      'orders:accept',
      'orders:pack',
      'orders:handover',
      'products:view',
      'products:create',
      'products:edit',
      'inventory:view',
      'inventory:toggle_stock',
      'inventory:update_stock',
      'seasonal:view',
      'seasonal:manage',
      'custom_products:view',
      'custom_products:create',
      'notifications:view',
      'store_settings:toggle_status',
    ],
    isSystem: true,
  },
  {
    name: 'Cashier',
    description: 'Counter & billing operations: view orders, check product & stock availability, view daily earnings & settlement ledger',
    permissions: [
      'dashboard:view',
      'orders:view',
      'products:view',
      'inventory:view',
      'finances:view_earnings',
      'finances:view_ledger',
      'notifications:view',
    ],
    isSystem: true,
  },
];

