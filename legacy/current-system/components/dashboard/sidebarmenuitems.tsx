import { Sidebarmenu } from "../../interface/type"

export const Sidemenuitems: Sidebarmenu[] =[
    {
        title:"Dashboard",
        path: "/dashboard",
        icon: "/icons/sidebar.svg",
        permissionKey: "dashboard",

    },

     {
        title:"Branch Management",
        path: "/dashboard/branchManagement",
        icon: "/icons/sidebar.svg",
        permissionKey: "branch",

    },

     {
        title:"Agents",
        path: "/dashboard/agents",
        icon: "/icons/sidebar.svg",
        permissionKey: "agents",

    },

     {
        title:"Package",
        path: "/dashboard/package",
        icon: "/icons/sidebar.svg",
        permissionKey: "packages",
        submenu: true,
        submenuitems: [
            {title: 'Collection', path: "/dashboard/package/collection", icon: "/icons/brown.png"},
            {title: 'Loan', path: "/dashboard/package/loan", icon: "/icons/blue.png"},
            {title: 'Investment', path: "/dashboard/package/investment", icon: "/icons/green.png"}

        ]

    },

    {
        title:"Collection",
        path: "/dashboard/collection",
        icon: "/icons/sidebar.svg",
        permissionKey: "collection",
        submenu: true,
        submenuitems: [
            {title: 'Collections', path: "/dashboard/collection/collections", icon: "/icons/brown.png"},
            {title: 'Remittance', path: "/dashboard/collection/remittance", icon: "/icons/green.png"},
           
        ]

    },

     {
        title:"Loan",
        path: "/dashboard/loan",
        icon: "/icons/sidebar.svg",
        permissionKey: "loan",
        submenu: true,
        submenuitems: [
            {title: 'Applications', path: "/dashboard/loan/applications", icon: "/icons/blue.png"},
            {title: 'Loans', path: "/dashboard/loan/loans", icon: "/icons/Vector.png"},
            {title: 'Repayments', path: "/dashboard/loan/repayments", icon: "/icons/green.png"}

        ]

    },

    {
        title:"Investment",
        path: "/dashboard/investment",
        icon: "/icons/sidebar.svg",
        permissionKey: "investments",
        submenu: true,
        submenuitems: [
            {title: 'Applications', path: "/dashboard/investment/applications", icon: "/icons/green.png"},
            {title: 'Investments', path: "/dashboard/investment/investments", icon: "/icons/Vector.png"},
            {title: 'Transactions', path: "/dashboard/investment/transactions", icon: "/icons/brown.png"}

        ]

    },

     {
        title:"Accounting",
        path: "/dashboard/accounting",
        icon: "/icons/sidebar.svg",
        permissionKey: "accounting",
        submenu: true,
        submenuitems: [
            {title: 'Analytics', path: "/dashboard/accounting/analytics", icon: "/icons/green.png"},
            {title: 'Journals', path: "/dashboard/accounting/journals", icon: "/icons/blue.png"},
            {title: 'Ledgers', path: "/dashboard/accounting/ledgers", icon: "/icons/Vector.png"},
            {title: 'Reports', path: "/dashboard/accounting/reports", icon: "/icons/brown.png"},
            {title: 'Setup & COA', path: "/dashboard/accounting/setup", icon: "/icons/green.png"},
           
        ]

    },


    {
        title:"Customer",
        path: "/dashboard/customer",
        icon: "/icons/sidebar.svg",
        permissionKey: "customers",

    },


    {
        title:"Wallet",
        path: "/dashboard/wallet",
        icon: "/icons/sidebar.svg",
        permissionKey: "wallet",

    },

    {
        title:"Charges",
        path: "/dashboard/charges",
        icon: "/icons/sidebar.svg",
        permissionKey: "charges",

    },

    {
        title:"Staff Management",
        path: "/dashboard/staffManagement",
        icon: "/icons/sidebar.svg",
        permissionKey: "staff_management",

    },

    {
        title:"Subscription",
        path: "/dashboard/subscription",
        icon: "/icons/sidebar.svg",
        permissionKey: "subscription",
    },


]
