export interface faqss {
    id: number;
    question: string;
    answer: string;
}

interface help {
    icon: string,
    slug: string;
    title: string;
    text: string;
    faqs: faqss[];
}

export const helpCategories: help[] = [
    {
        icon: "/icons/started.svg",
        slug: "getting-started",
        title: "Getting Started",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How do I create an account?",
                answer: "Click the signup button and complete the form."
            },
            {
                id: 2,
                question: "How do I login?",
                answer: "Enter your email and password."
            }
        ]
    },

    {
        icon: "/icons/dashboard.svg",
        slug: "merchant-dashboard",
        title: "Merchant Dashboard",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How do I track transactions?",
                answer: "Go to Dashboard → Transactions."
            },
            {
                id: 2,
                question: "How do I withdraw?",
                answer: "Open Wallet → Withdraw."
            }
        ]
    },


    {
        icon: "/icons/agents.svg",
        slug: "agents",
        title: "Agents",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How do I add a new agent?",
                answer: "Go to Agents → Add New Agent and fill out the details."
            },
            {
                id: 2,
                question: "Can agents manage customer accounts?",
                answer: "Agents can only access permissions assigned to them."
            },
            {
                id: 3,
                question: "How do I deactivate an agent?",
                answer: "Open the agent profile and click Deactivate."
            }
        ]
    },

    {
        icon: "/icons/customers.svg",
        slug: "customers",
        title: "Customers",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How do I view my customers?",
                answer: "Navigate to Dashboard → Customers to see all customer accounts."
            },
            {
                id: 2,
                question: "Can I block a customer?",
                answer: "Yes, click on the customer's profile and select Block."
            },
            {
                id: 3,
                question: "How do I resolve customer complaints?",
                answer: "Check the Support → Complaints section for customer reports."
            }
        ]
    },


    {
        icon: "/icons/billings.svg",
        slug: "billings-plans",
        title: "Billings & Plans",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How do I upgrade my plan?",
                answer: "Go to Settings → Billing → Choose a plan and complete payment."
            },
            {
                id: 2,
                question: "What payment methods are supported?",
                answer: "We support card payments, bank transfers, and wallet payments."
            },
            {
                id: 3,
                question: "Will my plan renew automatically?",
                answer: "Yes, all plans renew automatically unless you cancel manually."
            }
        ]
    },


    {
        icon: "/icons/security.svg",
        slug: "security-compliance",
        title: "Security & Compliance",
        text: "Set up your account and begin quickly.",
        faqs: [
            {
                id: 1,
                question: "How is my data protected?",
                answer: "We use industry-grade encryption and secure storage for all data."
            },
            {
                id: 2,
                question: "Do you comply with data regulations?",
                answer: "Yes, we comply with GDPR, NDPR, and other relevant policies."
            },
            {
                id: 3,
                question: "How can I report a security issue?",
                answer: "Send an email to security@yourapp.com or use the Support page."
            }
        ]
    }
];


interface contacts {
    icon: string,
    title: string,
    text: string,
    link: string
}


export const contact: contacts[] = [
    {
        icon: "/icons/caht.svg",
        title: "Live Chat",
        text: "Chat instantly with our support team",
        link: "Click to chat"
    },
    {
        icon: "/icons/caht.svg",
        title: "Email support",
        text: "Send us a message anytime",
        link: "Support@alphakolect.com"
    },
    {
        icon: "/icons/caht.svg",
        title: "Phone Support",
        text: "Direct line for enterprise clients only",
        link: "+23470662112467"
    }
]



import { MerchantData } from "../../interface/type";
  const generateMockData = (): MerchantData[] => {
    return [
      { id: 'COL-103-A45', package: 'Basic', no_of_agents: '10', no_of_customers: '20', customer: 'Rupet Microfinance', method: "wallet", status: 'active', created: '23 Jan, 2025' },
      { id: 'COL-203-B12', package: 'Free', no_of_agents: '20', no_of_customers: '30', customer: 'Rupet Microfinance', method: "wallet", status: 'active', created: '23 Jan, 2025' },
      { id: 'COL-304-C78', package: 'Pro', no_of_agents: '5', no_of_customers: '15', customer: 'Rupet Microfinance', method: "card", status: 'inactive', created: '22 Jan, 2025' },
      { id: 'COL-405-D34', package: 'Custom', no_of_agents: '10', no_of_customers: '25', customer: 'Rupet Microfinance', method: "wallet", status: 'active', created: '21 Jan, 2025' },
      { id: 'COL-506-E90', package: 'Basic', no_of_agents: '20', no_of_customers: '30', customer: 'Michael Brown', method: "transfer", status: 'inactive', created: '20 Jan, 2025' },
      { id: 'COL-607-F56', package: 'Free', no_of_agents: '33', no_of_customers: '45', customer: 'Emily Davis', method: "wallet", status: 'active', created: '19 Jan, 2025' },
      { id: 'COL-708-G23', package: 'Pro', no_of_agents: '30', no_of_customers: '40', customer: 'David Wilson', method: "card", status: 'active', created: '18 Jan, 2025' },
      { id: 'COL-809-H89', package: 'Custom', no_of_agents: '40', no_of_customers: '50', customer: 'Lisa Anderson', method: "wallet", status: 'inactive', created: '17 Jan, 2025' },
      { id: 'COL-910-I45', package: 'Basic', no_of_agents: "23", no_of_customers: '25', customer: 'Robert Taylor', method: "transfer", status: 'active', created: '16 Jan, 2025' },
      { id: 'COL-011-J12', package: 'Free', no_of_agents: '92', no_of_customers: '35', customer: 'Jennifer Martinez', method: "wallet", status: 'active', created: '15 Jan, 2025' },
      { id: 'COL-112-K78', package: 'Pro', no_of_agents: '94', no_of_customers: '45', customer: 'Christopher Lee', method: "card", status: 'inactive', created: '14 Jan, 2025' },
      { id: 'COL-213-L34', package: 'Custom', no_of_agents: '21', no_of_customers: '33', customer: 'Amanda White', method: "wallet", status: 'active', created: '13 Jan, 2025' },
    ];
  };
  export default generateMockData;
