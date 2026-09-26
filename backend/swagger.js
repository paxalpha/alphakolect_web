const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Centralized Swagger/OpenAPI configuration
const controllersGlob = path.join(__dirname, 'controllers', '**', '*.js').replace(/\\/g, '/');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AlphaWeb API',
      version: '1.0.0',
      description: 'API documentation for AlphaWeb investment management system. To authenticate: 1) Use the /api/auth/login endpoint to get a JWT token, 2) Click the "Authorize" button below, 3) Enter your JWT token (without "Bearer" prefix).',
      contact: {
        name: 'AlphaWeb Team',
        email: 'support@alphaweb.com'
      },
      license: {
        name: 'Proprietary',
        url: 'http://alphakolect.com/terms'
      }
    },
    externalDocs: {
      description: 'Find more info here',
      url: 'http://alphakolect.com/docs'
    },
    tags: [
      { name: 'Authentication', description: 'User authentication endpoints' },
      { name: 'Agents', description: 'Agent management operations' },
      { name: 'Branches', description: 'Branch management operations' },
      { name: 'Roles', description: 'Role and permission management' },
      { name: 'Staff', description: 'Staff management operations' },
      { name: 'Charges', description: 'Charge and fee management' },
      { name: 'Wallet', description: 'Merchant wallet operations' },
      { name: 'Customer Wallets', description: 'Customer wallet management' },
      { name: 'Dashboard', description: 'Dashboard statistics and analytics' },
      { name: 'Collections', description: 'Collections management' },
      { name: 'Single Collections', description: 'Create and manage individual collections' },
      { name: 'Bulk Collections', description: 'Create multiple collections in one request' },
      { name: 'Remittances', description: 'Remittances management' },
      { name: 'Investments', description: 'Investment management' },
      { name: 'Investment Transactions', description: 'Investment transaction management' },
      { name: 'Loan Applications', description: 'Loan application processing' },
      { name: 'Loans', description: 'Loan management' },
      { name: 'Repayments', description: 'Loan repayment operations' },
      { name: 'Packages', description: 'Investment package management' },
      { name: 'Investment Applications', description: 'Investment application processing' },
      { name: 'Customers', description: 'Customer records management' },
      { name: 'Reports', description: 'Reporting and analytics' }
    ],
    servers: [
      { 
        url: 'http://alphakolect.com/api', 
        description: 'Production API (http)' 
      },
      { 
        url: 'http://alphakolect.com/api', 
        description: 'Production API (HTTP)' 
      },
      { 
        url: 'http://localhost:5000/api', 
        description: 'Local Development' 
      },
      { 
        url: 'http://localhost:3000/api', 
        description: 'Alternative Local Development' 
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token without "Bearer" prefix. Example: eyJhbGciOiJIUzI1NiIs...',
          name: 'Authorization',
          in: 'header'
        }
      },
      schemas: {
        // Common Response Schemas
        ApiResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates if the request was successful'
            },
            message: {
              type: 'string',
              description: 'Response message'
            },
            data: {
              type: 'object',
              description: 'Response data'
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                pages: { type: 'integer' }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            error: {
              type: 'string',
              description: 'Detailed error information',
              nullable: true
            },
            code: {
              type: 'string',
              description: 'Error code',
              nullable: true
            }
          }
        },

        // Authentication Schemas
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'agent@example.com',
              description: 'User email address'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'yourpassword123',
              description: 'User password'
            }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { 
              type: 'boolean',
              example: true,
              description: 'Indicates if login was successful'
            },
            message: { 
              type: 'string',
              example: 'Login successful',
              description: 'Response message'
            },
            token: { 
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              description: 'JWT authentication token'
            },
            user: {
              type: 'object',
              properties: {
                id: { 
                  type: 'integer',
                  example: 1,
                  description: 'User ID'
                },
                email: { 
                  type: 'string',
                  example: 'agent@example.com',
                  description: 'User email'
                },
                name: { 
                  type: 'string',
                  example: 'John Doe',
                  description: 'User name'
                },
                type: { 
                  type: 'string',
                  example: 'agent',
                  description: 'User type (merchant, agent, staff)'
                },
                merchantId: { 
                  type: 'integer',
                  example: 1,
                  description: 'Associated merchant ID'
                }
              }
            }
          }
        },
        RegisterRequest: {
          type: 'object',
          required: ['businessName', 'email', 'password'],
          properties: {
            businessName: {
              type: 'string',
              example: 'AlphaWeb Solutions',
              description: 'Business name'
            },
            businessAlias: {
              type: 'string',
              example: 'AWS',
              description: 'Business alias'
            },
            phone: {
              type: 'string',
              example: '+2348012345678',
              description: 'Phone number'
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'admin@alphaweb.com',
              description: 'Email address'
            },
            currency: {
              type: 'string',
              example: 'NGN',
              description: 'Currency code'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'securepassword123',
              description: 'Password'
            }
          }
        },
        RegisterResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Merchant registered successfully. Please verify your email with the OTP sent.',
              description: 'Registration message'
            },
            merchantId: {
              type: 'integer',
              example: 1,
              description: 'Created merchant ID'
            },
            otp: {
              type: 'string',
              example: '123456',
              description: 'OTP for email verification'
            },
            emailSent: {
              type: 'boolean',
              example: true,
              description: 'Whether OTP email was sent'
            }
          }
        },

        // Agent Schema
        Agent: {
          type: 'object',
          example: {
            id: 1,
            name: 'John',
            fullName: 'John Doe',
            phone: '+2348012345678',
            phoneNumber: '+2348012345678',
            branch: 'Main Branch',
            email: 'john.doe@example.com',
            password: '$2b$10$hashedpasswordexample',
            merchantId: 1,
            status: 'active',
            customersCount: 25,
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 1,
              description: 'Unique identifier for the agent'
            },
            name: { 
              type: 'string',
              example: 'John',
              description: 'Agent display name'
            },
            fullName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Agent full legal name'
            },
            phone: { 
              type: 'string',
              nullable: true,
              example: '+2348012345678',
              description: 'Agent phone number'
            },
            phoneNumber: { 
              type: 'string',
              nullable: true,
              example: '+2348012345678',
              description: 'Alternative phone number'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name where agent operates'
            },
            email: { 
              type: 'string',
              format: 'email',
              example: 'john.doe@example.com',
              description: 'Agent email address'
            },
            password: { 
              type: 'string',
              example: '$2b$10$hashedpasswordexample',
              description: 'Hashed password for authentication'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended'],
              example: 'active',
              description: 'Agent account status'
            },
            customersCount: {
              type: 'integer',
              example: 25,
              description: 'Number of customers assigned to this agent'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        AgentCreateRequest: {
          type: 'object',
          required: ['fullName', 'email', 'password', 'merchantId'],
          properties: {
            name: {
              type: 'string',
              example: 'John',
              description: 'Agent display name'
            },
            fullName: {
              type: 'string',
              example: 'John Doe',
              description: 'Agent full legal name'
            },
            phoneNumber: {
              type: 'string',
              example: '+2348012345678',
              description: 'Agent phone number'
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'john.doe@example.com',
              description: 'Agent email address'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'securepassword123',
              description: 'Agent password'
            },
            branch: {
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            merchantId: {
              type: 'integer',
              example: 1,
              description: 'Merchant ID'
            }
          }
        },
        AgentUpdateRequest: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'integer',
              example: 1,
              description: 'Agent ID'
            },
            fullName: {
              type: 'string',
              example: 'John Doe Updated',
              description: 'Agent full legal name'
            },
            phoneNumber: {
              type: 'string',
              example: '+2348012345678',
              description: 'Agent phone number'
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'john.doe.updated@example.com',
              description: 'Agent email address'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'newpassword123',
              description: 'New password (optional)'
            },
            branch: {
              type: 'string',
              example: 'Updated Branch',
              description: 'Branch name'
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended'],
              example: 'active',
              description: 'Agent status'
            }
          }
        },

        // Branch Schema
        Branch: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 1,
              description: 'Branch ID'
            },
            name: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            state: { 
              type: 'string',
              example: 'Lagos',
              description: 'State where branch is located'
            },
            location: { 
              type: 'string',
              example: 'Ikeja',
              description: 'Specific location of the branch'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            managerId: { 
              type: 'integer', 
              nullable: true,
              example: 5,
              description: 'Branch manager ID'
            },
            contactEmail: { 
              type: 'string', 
              format: 'email', 
              nullable: true,
              example: 'main@alphaweb.com',
              description: 'Branch contact email'
            },
            contactPhone: { 
              type: 'string', 
              nullable: true,
              example: '+2348012345678',
              description: 'Branch contact phone'
            },
            status: { 
              type: 'string', 
              enum: ['active', 'inactive'],
              example: 'active',
              description: 'Branch status'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        BranchCreateRequest: {
          type: 'object',
          required: ['name', 'state', 'location', 'merchantId'],
          properties: {
            name: {
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            state: {
              type: 'string',
              example: 'Lagos',
              description: 'State where branch is located'
            },
            location: {
              type: 'string',
              example: 'Ikeja',
              description: 'Specific location of the branch'
            },
            merchantId: {
              type: 'integer',
              example: 1,
              description: 'Merchant ID'
            },
            managerId: {
              type: 'integer',
              example: 5,
              description: 'Branch manager ID (optional)'
            },
            contactEmail: {
              type: 'string',
              format: 'email',
              example: 'main@alphaweb.com',
              description: 'Branch contact email (optional)'
            },
            contactPhone: {
              type: 'string',
              example: '+2348012345678',
              description: 'Branch contact phone (optional)'
            }
          }
        },

        // Role Schema
        Role: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 1,
              description: 'Role ID'
            },
            roleName: { 
              type: 'string',
              example: 'Admin',
              description: 'Role name'
            },
            cantView: { 
              type: 'integer',
              example: 0,
              description: 'Number of items user cannot view'
            },
            canViewOnly: { 
              type: 'integer',
              example: 5,
              description: 'Number of items user can view only'
            },
            canEdit: { 
              type: 'integer',
              example: 10,
              description: 'Number of items user can edit'
            },
            permissions: { 
              type: 'object',
              example: {
                "customers": "full",
                "agents": "view",
                "loans": "edit",
                "investments": "view"
              },
              description: 'Detailed permissions object',
              additionalProperties: true 
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        RoleCreateRequest: {
          type: 'object',
          required: ['roleName'],
          properties: {
            roleName: {
              type: 'string',
              example: 'Manager',
              description: 'Role name'
            },
            cantView: {
              type: 'array',
              items: { type: 'string' },
              example: ['admin_settings', 'financial_reports'],
              description: 'Items user cannot view'
            },
            canViewOnly: {
              type: 'array',
              items: { type: 'string' },
              example: ['customer_data', 'agent_performance'],
              description: 'Items user can view only'
            },
            canEdit: {
              type: 'array',
              items: { type: 'string' },
              example: ['loans', 'investments', 'collections'],
              description: 'Items user can edit'
            },
            permissions: {
              type: 'object',
              example: {
                "customers": "full",
                "agents": "view",
                "loans": "edit"
              },
              description: 'Detailed permissions object'
            }
          }
        },

        // Staff Schema
        Staff: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 1,
              description: 'Staff ID'
            },
            fullName: { 
              type: 'string',
              example: 'Alice Smith',
              description: 'Staff full name'
            },
            email: { 
              type: 'string', 
              format: 'email',
              example: 'alice.smith@example.com',
              description: 'Staff email address'
            },
            phoneNumber: { 
              type: 'string',
              example: '+2348012345678',
              description: 'Staff phone number'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch where staff works'
            },
            role: { 
              type: 'string',
              example: 'Manager',
              description: 'Staff role'
            },
            status: { 
              type: 'string', 
              enum: ['active', 'inactive', 'suspended'],
              example: 'active',
              description: 'Staff status'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            roleId: { 
              type: 'integer',
              example: 2,
              description: 'Associated role ID'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        StaffCreateRequest: {
          type: 'object',
          required: ['fullName', 'email', 'phoneNumber', 'roleId', 'merchantId'],
          properties: {
            fullName: {
              type: 'string',
              example: 'Alice Smith',
              description: 'Staff full name'
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'alice.smith@example.com',
              description: 'Staff email address'
            },
            phoneNumber: {
              type: 'string',
              example: '+2348012345678',
              description: 'Staff phone number'
            },
            branch: {
              type: 'string',
              example: 'Main Branch',
              description: 'Branch where staff works'
            },
            role: {
              type: 'string',
              example: 'Manager',
              description: 'Staff role'
            },
            merchantId: {
              type: 'integer',
              example: 1,
              description: 'Merchant ID'
            },
            roleId: {
              type: 'integer',
              example: 2,
              description: 'Role ID'
            }
          }
        },

        // Charge Schema
        Charge: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 1,
              description: 'Charge ID'
            },
            name: { 
              type: 'string',
              example: 'Processing Fee',
              description: 'Charge name'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 100.50,
              description: 'Charge amount'
            },
            type: { 
              type: 'string', 
              enum: ['fixed', 'percentage'],
              example: 'fixed',
              description: 'Charge type'
            },
            category: { 
              type: 'string',
              example: 'Service',
              description: 'Charge category'
            },
            status: { 
              type: 'string', 
              enum: ['active', 'inactive'],
              example: 'active',
              description: 'Charge status'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        ChargeCreateRequest: {
          type: 'object',
          required: ['name', 'type', 'amount'],
          properties: {
            name: {
              type: 'string',
              example: 'Processing Fee',
              description: 'Charge name'
            },
            type: {
              type: 'string',
              enum: ['Loan', 'Penalty', 'Service'],
              example: 'Service',
              description: 'Charge type'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 100.50,
              description: 'Charge amount'
            },
            category: {
              type: 'string',
              example: 'Service',
              description: 'Charge category'
            }
          }
        },

        // Wallet Transaction Schema
        WalletTransaction: {
          type: 'object',
          example: {
            id: 9001,
            type: 'credit',
            transactionType: 'credit',
            amount: 2000.00,
            status: 'Completed',
            reference: 'TXN123456',
            description: 'Payment received from customer',
            merchantId: 1,
            paymentMethod: 'Bank Transfer',
            relatedId: 123,
            relatedType: 'customer_wallet',
            notes: 'Transaction processed successfully',
            balanceBefore: 5000.00,
            balanceAfter: 7000.00,
            category: 'Collection',
            processedBy: 2,
            date: '2024-01-15T10:30:00.000Z',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 9001,
              description: 'Transaction ID'
            },
            type: { 
              type: 'string',
              example: 'credit',
              description: 'Transaction type'
            },
            transactionType: { 
              type: 'string',
              example: 'credit',
              description: 'Detailed transaction type'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 2000.00,
              description: 'Transaction amount'
            },
            status: { 
              type: 'string',
              example: 'Completed',
              description: 'Transaction status'
            },
            reference: { 
              type: 'string',
              example: 'TXN123456',
              description: 'Transaction reference'
            },
            description: { 
              type: 'string',
              example: 'Payment received from customer',
              description: 'Transaction description'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            paymentMethod: {
              type: 'string',
              example: 'Bank Transfer',
              description: 'Payment method used'
            },
            relatedId: {
              type: 'integer',
              example: 123,
              description: 'Related entity ID'
            },
            relatedType: {
              type: 'string',
              example: 'customer_wallet',
              description: 'Related entity type'
            },
            notes: {
              type: 'string',
              example: 'Transaction processed successfully',
              description: 'Additional notes'
            },
            balanceBefore: { 
              type: 'number', 
              format: 'float',
              example: 5000.00,
              description: 'Wallet balance before transaction'
            },
            balanceAfter: { 
              type: 'number', 
              format: 'float',
              example: 7000.00,
              description: 'Wallet balance after transaction'
            },
            category: { 
              type: 'string',
              example: 'Collection',
              description: 'Transaction category'
            },
            processedBy: { 
              type: 'integer',
              example: 2,
              description: 'User ID who processed the transaction'
            },
            date: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Transaction date'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        WalletTransactionCreateRequest: {
          type: 'object',
          required: ['type', 'amount'],
          properties: {
            type: {
              type: 'string',
              enum: ['credit', 'debit'],
              example: 'credit',
              description: 'Transaction type'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 1000.00,
              description: 'Transaction amount'
            },
            description: {
              type: 'string',
              example: 'Payment received',
              description: 'Transaction description'
            },
            reference: {
              type: 'string',
              example: 'TXN123456',
              description: 'Transaction reference'
            },
            paymentMethod: {
              type: 'string',
              example: 'Bank Transfer',
              description: 'Payment method'
            }
          }
        },

        // Customer Wallet Schema
        CustomerWallet: {
          type: 'object',
          example: {
            id: 81,
            customerId: 12,
            customerName: 'John Doe',
            balance: 2000.00,
            status: 'active',
            accountNumber: 'ACC123456',
            accountLevel: 'Tier 1',
            merchantId: 1,
            lastTransactionAt: '2024-01-15T10:30:00.000Z',
            activationDate: '2024-01-15T10:30:00.000Z',
            dailyLimit: 1000000.00,
            monthlyLimit: 10000000.00,
            notes: 'Premium customer wallet',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 81,
              description: 'Wallet ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            balance: { 
              type: 'number', 
              format: 'float',
              example: 2000.00,
              description: 'Wallet balance'
            },
            status: { 
              type: 'string', 
              enum: ['active', 'frozen', 'closed'],
              example: 'active',
              description: 'Wallet status'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            accountLevel: {
              type: 'string',
              example: 'Tier 1',
              description: 'Account level'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            lastTransactionAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last transaction timestamp'
            },
            activationDate: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Wallet activation date'
            },
            dailyLimit: {
              type: 'number',
              format: 'float',
              example: 1000000.00,
              description: 'Daily transaction limit'
            },
            monthlyLimit: {
              type: 'number',
              format: 'float',
              example: 10000000.00,
              description: 'Monthly transaction limit'
            },
            notes: {
              type: 'string',
              example: 'Premium customer wallet',
              description: 'Additional notes'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Last update timestamp'
            }
          }
        },
        CustomerWalletCreateRequest: {
          type: 'object',
          required: ['customerId', 'accountNumber'],
          properties: {
            customerId: {
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            accountLevel: {
              type: 'string',
              example: 'Tier 1',
              description: 'Account level'
            },
            balance: {
              type: 'number',
              format: 'float',
              example: 0.00,
              description: 'Initial balance'
            },
            notes: {
              type: 'string',
              example: 'Premium customer wallet',
              description: 'Additional notes'
            }
          }
        },

        // Dashboard Stats Schema
        DashboardStats: {
          type: 'object',
          properties: {
            walletBalance: { 
              type: 'number', 
              format: 'float',
              example: 150000.00,
              description: 'Current wallet balance'
            },
            allCollectionWallet: { 
              type: 'number', 
              format: 'float',
              example: 95000.00,
              description: 'Total collection wallet balance'
            },
            totalDue: { 
              type: 'number', 
              format: 'float',
              example: 120000.00,
              description: 'Total amount due'
            },
            smsBalance: { 
              type: 'integer',
              example: 75,
              description: 'SMS balance count'
            },
            totalCustomers: { 
              type: 'integer',
              example: 420,
              description: 'Total number of customers'
            },
            totalAgents: { 
              type: 'integer',
              example: 35,
              description: 'Total number of agents'
            },
            activeLoans: { 
              type: 'integer',
              example: 55,
              description: 'Number of active loans'
            },
            activeInvestments: { 
              type: 'integer',
              example: 28,
              description: 'Number of active investments'
            },
            totalCollections: { 
              type: 'number', 
              format: 'float',
              example: 250000.00,
              description: 'Total collections amount'
            },
            pendingCollections: { 
              type: 'number', 
              format: 'float',
              example: 50000.00,
              description: 'Pending collections amount'
            },
            completedCollections: { 
              type: 'number', 
              format: 'float',
              example: 200000.00,
              description: 'Completed collections amount'
            }
          }
        },
        DashboardTransactionStats: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              example: 'Jan',
              description: 'Month name'
            },
            Collection: {
              type: 'number',
              format: 'float',
              example: 120000.00,
              description: 'Collection amount for the month'
            },
            Investment: {
              type: 'number',
              format: 'float',
              example: 80000.00,
              description: 'Investment amount for the month'
            },
            Loan: {
              type: 'number',
              format: 'float',
              example: 40000.00,
              description: 'Loan amount for the month'
            }
          }
        },

        // Collection Schema
        Collection: {
          type: 'object',
          example: {
            id: 101,
            customerId: 12,
            customerName: 'John Doe',
            amount: 5000.00,
            amountCollected: 5000.00,
            dueDate: '2025-01-31T00:00:00.000Z',
            collectedDate: '2025-01-31T10:30:00.000Z',
            type: 'Daily',
            description: 'Daily savings collection',
            collectionNotes: 'Customer requested early collection',
            priority: 'Medium',
            reminderSent: false,
            reminderDate: '2025-01-30T09:00:00.000Z',
            packageId: 801,
            packageName: 'Premium Package',
            packageAmount: 50000.00,
            cycle: 30,
            cycleCounter: 5,
            isFirstCollection: false,
            status: 'Pending',
            merchantId: 1,
            agentId: 3,
            dateCreated: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 101,
              description: 'Collection ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 5000.00,
              description: 'Collection amount'
            },
            amountCollected: { 
              type: 'number', 
              format: 'float',
              example: 5000.00,
              description: 'Amount collected'
            },
            dueDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2025-01-31T00:00:00.000Z',
              description: 'Due date for collection'
            },
            collectedDate: { 
              type: 'string', 
              format: 'date-time', 
              nullable: true,
              example: '2025-01-31T10:30:00.000Z',
              description: 'Date when collection was made'
            },
            type: { 
              type: 'string', 
              enum: ['Daily', 'Weekly', 'Monthly'],
              example: 'Daily',
              description: 'Collection type'
            },
            description: { 
              type: 'string',
              example: 'Daily savings collection',
              description: 'Collection description'
            },
            collectionNotes: { 
              type: 'string',
              example: 'Customer requested early collection',
              description: 'Additional collection notes'
            },
            priority: { 
              type: 'string',
              enum: ['Low', 'Medium', 'High'],
              example: 'Medium',
              description: 'Collection priority level'
            },
            reminderSent: { 
              type: 'boolean',
              example: false,
              description: 'Whether reminder has been sent'
            },
            reminderDate: { 
              type: 'string', 
              format: 'date-time',
              nullable: true,
              example: '2025-01-30T09:00:00.000Z',
              description: 'Date when reminder was sent'
            },
            packageId: { 
              type: 'integer',
              example: 801,
              description: 'Package ID'
            },
            packageName: { 
              type: 'string',
              example: 'Premium Package',
              description: 'Package name'
            },
            packageAmount: { 
              type: 'number', 
              format: 'float',
              example: 50000.00,
              description: 'Package amount'
            },
            cycle: { 
              type: 'integer',
              example: 30,
              description: 'Collection cycle'
            },
            cycleCounter: { 
              type: 'integer',
              example: 5,
              description: 'Current cycle counter'
            },
            isFirstCollection: { 
              type: 'boolean',
              example: false,
              description: 'Whether this is the first collection'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Collected', 'Overdue', 'Cancelled'],
              example: 'Pending',
              description: 'Collection status'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the collection'
            },
            dateCreated: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Collection creation date'
            }
          }
        },
        CollectionCreateRequest: {
          type: 'object',
          required: ['customerName', 'amount', 'dueDate', 'type'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 5000.00,
              description: 'Collection amount'
            },
            dueDate: {
              type: 'string',
              format: 'date',
              example: '2025-01-31',
              description: 'Due date for collection'
            },
            type: {
              type: 'string',
              enum: ['Daily', 'Weekly', 'Monthly'],
              example: 'Daily',
              description: 'Collection type'
            },
            description: {
              type: 'string',
              example: 'Daily savings collection',
              description: 'Collection description'
            },
            packageName: {
              type: 'string',
              example: 'Premium Package',
              description: 'Package name'
            },
            packageAmount: {
              type: 'number',
              format: 'float',
              example: 50000.00,
              description: 'Package amount'
            },
            cycle: {
              type: 'integer',
              example: 30,
              description: 'Collection cycle'
            },
            cycleCounter: {
              type: 'integer',
              example: 5,
              description: 'Current cycle counter'
            },
            isFirstCollection: {
              type: 'boolean',
              example: false,
              description: 'Whether this is the first collection'
            }
          }
        },

        // Remittance Schema
        Remittance: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 201,
              description: 'Remittance ID'
            },
            collectionId: { 
              type: 'integer',
              example: 101,
              description: 'Associated collection ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 5000.00,
              description: 'Remittance amount'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the remittance'
            },
            agentName: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Completed', 'Failed'],
              example: 'Pending',
              description: 'Remittance status'
            },
            notes: { 
              type: 'string',
              example: 'Daily collection remittance',
              description: 'Additional notes'
            },
            remittanceDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2025-01-31T10:30:00.000Z',
              description: 'Date when remittance was made'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Remittance creation date'
            }
          }
        },
        RemittanceCreateRequest: {
          type: 'object',
          required: ['customerName', 'amount'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 5000.00,
              description: 'Remittance amount'
            },
            agentId: {
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the remittance'
            },
            notes: {
              type: 'string',
              example: 'Daily collection remittance',
              description: 'Additional notes'
            }
          }
        },

        // Investment Schema
        Investment: {
          type: 'object',
          example: {
            id: 301,
            customerId: 12,
            customerName: 'John Doe',
            accountNumber: 'ACC123456',
            amount: 100000.00,
            interestRate: 12.5,
            plan: 'Premium Investment Plan',
            duration: 365,
            agentId: 3,
            agentName: 'Agent Smith',
            branch: 'Main Branch',
            status: 'Active',
            merchantId: 1,
            startDate: '2024-01-15T00:00:00.000Z',
            maturityDate: '2025-01-15T00:00:00.000Z',
            expectedReturns: 120000.00,
            actualReturns: 0.00,
            notes: 'Long-term investment for retirement',
            approvedBy: 2,
            approvedAt: '2024-01-15T14:30:00.000Z',
            totalReturn: 120000.00,
            currentValue: 105000.00,
            dateCreated: '2024-01-15T10:30:00.000Z',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 301,
              description: 'Investment ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 100000.00,
              description: 'Investment amount'
            },
            interestRate: { 
              type: 'number', 
              format: 'float',
              example: 12.5,
              description: 'Interest rate percentage'
            },
            plan: { 
              type: 'string',
              example: 'Premium Investment Plan',
              description: 'Investment plan name'
            },
            duration: { 
              type: 'integer',
              example: 365,
              description: 'Investment duration in days'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the investment'
            },
            agentName: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            status: { 
              type: 'string', 
              enum: ['Active', 'Matured', 'Closed', 'Defaulted'],
              example: 'Active',
              description: 'Investment status'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            startDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T00:00:00.000Z',
              description: 'Investment start date'
            },
            maturityDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2025-01-15T00:00:00.000Z',
              description: 'Investment maturity date'
            },
            expectedReturns: { 
              type: 'number', 
              format: 'float',
              example: 120000.00,
              description: 'Expected returns at maturity'
            },
            actualReturns: { 
              type: 'number', 
              format: 'float',
              example: 0.00,
              description: 'Actual returns received'
            },
            notes: { 
              type: 'string',
              example: 'Long-term investment for retirement',
              description: 'Investment notes'
            },
            approvedBy: { 
              type: 'integer',
              example: 2,
              description: 'User ID who approved the investment'
            },
            approvedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T14:30:00.000Z',
              description: 'Investment approval date'
            },
            totalReturn: { 
              type: 'number', 
              format: 'float',
              example: 120000.00,
              description: 'Total return amount including principal and interest'
            },
            currentValue: { 
              type: 'number', 
              format: 'float',
              example: 105000.00,
              description: 'Current investment value'
            },
            dateCreated: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Investment creation date'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Investment creation timestamp'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Investment last update timestamp'
            }
          }
        },
        InvestmentCreateRequest: {
          type: 'object',
          required: ['customerName', 'amount', 'plan', 'duration'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 100000.00,
              description: 'Investment amount'
            },
            plan: {
              type: 'string',
              example: 'Premium Investment Plan',
              description: 'Investment plan name'
            },
            duration: {
              type: 'integer',
              example: 365,
              description: 'Investment duration in days'
            },
            startDate: {
              type: 'string',
              format: 'date',
              example: '2024-01-15',
              description: 'Investment start date'
            }
          }
        },

        // Investment Transaction Schema
        InvestmentTransaction: {
          type: 'object',
          properties: {
            id: { 
              type: 'integer',
              example: 401,
              description: 'Transaction ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customer: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            package: { 
              type: 'string',
              example: 'Premium Investment Package',
              description: 'Investment package name'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 100000.00,
              description: 'Transaction amount'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            agent: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            transactionType: { 
              type: 'string', 
              enum: ['Deposit', 'Withdrawal', 'Interest', 'Penalty'],
              example: 'Deposit',
              description: 'Transaction type'
            },
            notes: { 
              type: 'string',
              example: 'Initial investment deposit',
              description: 'Transaction notes'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Completed', 'Failed'],
              example: 'Completed',
              description: 'Transaction status'
            },
            transactionDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Transaction date'
            },
            reference: { 
              type: 'string',
              example: 'INV-TXN-2024-001',
              description: 'Transaction reference'
            }
          }
        },
        InvestmentTransactionCreateRequest: {
          type: 'object',
          required: ['customerName', 'amount', 'transactionType'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            package: {
              type: 'string',
              example: 'Premium Investment Package',
              description: 'Investment package name'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 100000.00,
              description: 'Transaction amount'
            },
            transactionType: {
              type: 'string',
              enum: ['Deposit', 'Withdrawal', 'Interest', 'Penalty'],
              example: 'Deposit',
              description: 'Transaction type'
            },
            notes: {
              type: 'string',
              example: 'Initial investment deposit',
              description: 'Transaction notes'
            }
          }
        },

        // Loan Application Schema
        LoanApplication: {
          type: 'object',
          example: {
            id: 501,
            customerId: 12,
            customerName: 'John Doe',
            accountNumber: 'ACC123456',
            requestedAmount: 500000.00,
            interestRate: 15.5,
            duration: 12,
            agentId: 3,
            agentName: 'Agent Smith',
            branch: 'Main Branch',
            notes: 'Business expansion loan',
            purpose: 'Business expansion',
            collateral: 'Property deed',
            status: 'Pending',
            dateApplied: '2024-01-15T10:30:00.000Z',
            merchantId: 1,
            creditScore: 750.0,
            riskLevel: 'Medium',
            approvedBy: 2,
            approvedAt: '2024-01-15T14:30:00.000Z',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 501,
              description: 'Loan application ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            requestedAmount: { 
              type: 'number', 
              format: 'float',
              example: 500000.00,
              description: 'Requested loan amount'
            },
            interestRate: { 
              type: 'number', 
              format: 'float',
              example: 15.5,
              description: 'Interest rate percentage'
            },
            duration: { 
              type: 'integer',
              example: 12,
              description: 'Loan duration in months'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the application'
            },
            agentName: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            notes: { 
              type: 'string',
              example: 'Business expansion loan',
              description: 'Application notes'
            },
            purpose: { 
              type: 'string',
              example: 'Business expansion',
              description: 'Loan purpose'
            },
            collateral: { 
              type: 'string',
              example: 'Property deed',
              description: 'Collateral provided'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Approved', 'Rejected', 'Under Review'],
              example: 'Pending',
              description: 'Application status'
            },
            dateApplied: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Application date'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            creditScore: { 
              type: 'number', 
              format: 'float', 
              nullable: true,
              example: 750.0,
              description: 'Customer credit score'
            },
            riskLevel: { 
              type: 'string', 
              enum: ['Low', 'Medium', 'High'], 
              nullable: true,
              example: 'Medium',
              description: 'Risk assessment level'
            },
            approvedBy: { 
              type: 'integer',
              example: 2,
              description: 'User ID who approved/rejected the application'
            },
            approvedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T14:30:00.000Z',
              description: 'Application approval/rejection date'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Application creation date'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Application last update date'
            }
          }
        },
        LoanApplicationCreateRequest: {
          type: 'object',
          required: ['customerName', 'requestedAmount', 'duration', 'purpose'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            requestedAmount: {
              type: 'number',
              format: 'float',
              example: 500000.00,
              description: 'Requested loan amount'
            },
            interestRate: {
              type: 'number',
              format: 'float',
              example: 15.5,
              description: 'Interest rate percentage'
            },
            duration: {
              type: 'integer',
              example: 12,
              description: 'Loan duration in months'
            },
            purpose: {
              type: 'string',
              example: 'Business expansion',
              description: 'Loan purpose'
            },
            collateral: {
              type: 'string',
              example: 'Property deed',
              description: 'Collateral provided'
            },
            notes: {
              type: 'string',
              example: 'Business expansion loan',
              description: 'Application notes'
            }
          }
        },

        // Loan Schema
        Loan: {
          type: 'object',
          example: {
            id: 601,
            customerId: 12,
            customerName: 'John Doe',
            accountNumber: 'ACC123456',
            loanAmount: 500000.00,
            interestRate: 15.5,
            duration: 12,
            agentId: 3,
            agentName: 'Agent Smith',
            branch: 'Main Branch',
            totalAmount: 575000.00,
            remainingAmount: 450000.00,
            amountPaid: 125000.00,
            status: 'Active',
            merchantId: 1,
            dateIssued: '2024-01-15T00:00:00.000Z',
            dueDate: '2025-01-15T00:00:00.000Z',
            notes: 'Business expansion loan for equipment purchase',
            approvedBy: 2,
            approvedAt: '2024-01-15T14:30:00.000Z',
            nextPaymentDate: '2024-02-15T00:00:00.000Z',
            loanType: 'Business Loan',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 601,
              description: 'Loan ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            loanAmount: { 
              type: 'number', 
              format: 'float',
              example: 500000.00,
              description: 'Original loan amount'
            },
            interestRate: { 
              type: 'number', 
              format: 'float',
              example: 15.5,
              description: 'Interest rate percentage'
            },
            duration: { 
              type: 'integer',
              example: 12,
              description: 'Loan duration in months'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the loan'
            },
            agentName: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            totalAmount: { 
              type: 'number', 
              format: 'float',
              example: 575000.00,
              description: 'Total amount including interest'
            },
            remainingAmount: { 
              type: 'number', 
              format: 'float',
              example: 450000.00,
              description: 'Remaining amount to be paid'
            },
            amountPaid: { 
              type: 'number', 
              format: 'float',
              example: 125000.00,
              description: 'Amount already paid'
            },
            status: { 
              type: 'string', 
              enum: ['Active', 'Paid', 'Defaulted', 'Written Off'],
              example: 'Active',
              description: 'Loan status'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            dateIssued: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T00:00:00.000Z',
              description: 'Loan issue date'
            },
            dueDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2025-01-15T00:00:00.000Z',
              description: 'Loan due date'
            },
            notes: { 
              type: 'string',
              example: 'Business expansion loan for equipment purchase',
              description: 'Loan notes'
            },
            approvedBy: { 
              type: 'integer',
              example: 2,
              description: 'User ID who approved the loan'
            },
            approvedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T14:30:00.000Z',
              description: 'Loan approval date'
            },
            nextPaymentDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-02-15T00:00:00.000Z',
              description: 'Next payment due date'
            },
            loanType: { 
              type: 'string',
              example: 'Business Loan',
              description: 'Type of loan'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Loan creation date'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Loan last update date'
            }
          }
        },
        LoanCreateRequest: {
          type: 'object',
          required: ['customerName', 'loanAmount', 'duration', 'interestRate'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            loanAmount: {
              type: 'number',
              format: 'float',
              example: 500000.00,
              description: 'Loan amount'
            },
            interestRate: {
              type: 'number',
              format: 'float',
              example: 15.5,
              description: 'Interest rate percentage'
            },
            duration: {
              type: 'integer',
              example: 12,
              description: 'Loan duration in months'
            },
            loanType: {
              type: 'string',
              example: 'Business Loan',
              description: 'Type of loan'
            }
          }
        },

        // Repayment Schema
        Repayment: {
          type: 'object',
          example: {
            id: 701,
            transactionId: 'REP-TXN-2024-001',
            loanId: 601,
            customerId: 12,
            customerName: 'John Doe',
            accountNumber: 'ACC123456',
            package: 'Premium Loan Package',
            amount: 50000.00,
            branch: 'Main Branch',
            agentId: 3,
            agentName: 'Agent Smith',
            paymentMethod: 'Cash',
            reference: 'REP-REF-2024-001',
            notes: 'Monthly loan repayment',
            status: 'Completed',
            paymentDate: '2024-01-15T10:30:00.000Z',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 701,
              description: 'Repayment ID'
            },
            transactionId: { 
              type: 'string',
              example: 'REP-TXN-2024-001',
              description: 'Transaction ID'
            },
            loanId: { 
              type: 'integer',
              example: 601,
              description: 'Associated loan ID'
            },
            customerId: { 
              type: 'integer',
              example: 12,
              description: 'Customer ID'
            },
            customerName: { 
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: { 
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            package: { 
              type: 'string',
              example: 'Premium Loan Package',
              description: 'Package name'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 50000.00,
              description: 'Repayment amount'
            },
            branch: { 
              type: 'string',
              example: 'Main Branch',
              description: 'Branch name'
            },
            agentId: { 
              type: 'integer',
              example: 3,
              description: 'Agent ID handling the repayment'
            },
            agentName: { 
              type: 'string',
              example: 'Agent Smith',
              description: 'Agent name'
            },
            paymentMethod: { 
              type: 'string', 
              enum: ['Cash', 'Transfer', 'Card', 'Mobile Money'],
              example: 'Cash',
              description: 'Payment method used'
            },
            reference: { 
              type: 'string',
              example: 'REP-REF-2024-001',
              description: 'Payment reference'
            },
            notes: { 
              type: 'string',
              example: 'Monthly loan repayment',
              description: 'Repayment notes'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Completed', 'Failed'],
              example: 'Completed',
              description: 'Repayment status'
            },
            paymentDate: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Payment date'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Repayment creation date'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Repayment last update date'
            }
          }
        },
        RepaymentCreateRequest: {
          type: 'object',
          required: ['customerName', 'amount', 'paymentMethod'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 50000.00,
              description: 'Repayment amount'
            },
            paymentMethod: {
              type: 'string',
              enum: ['Cash', 'Transfer', 'Card', 'Mobile Money'],
              example: 'Cash',
              description: 'Payment method used'
            },
            reference: {
              type: 'string',
              example: 'REP-REF-2024-001',
              description: 'Payment reference'
            },
            notes: {
              type: 'string',
              example: 'Monthly loan repayment',
              description: 'Repayment notes'
            }
          }
        },

        // Package Schema
        Package: {
          type: 'object',
          example: {
            id: 801,
            name: 'Premium Savings Package',
            type: 'Savings',
            amount: 100000.00,
            seedAmount: 10000.00,
            seedType: 'Fixed',
            period: 30,
            collectionDays: 'Daily',
            duration: 365,
            benefits: ['High interest rate', 'Flexible withdrawal', 'Bonus rewards'],
            description: 'Premium savings package with high returns',
            status: 'Active',
            interestRate: 12.5,
            extraCharges: 500.00,
            defaultPenalty: 1000.00,
            defaultDays: 7,
            loanAmount: 500000.00,
            loanInterestRate: 15.0,
            loanPeriod: 12,
            defaultAmount: 5000.00,
            gracePeriod: 30,
            loanCharges: 2500.00,
            packageCategory: 'Premium',
            maxCustomers: 100,
            currentCustomers: 25,
            minimumSavings: 1000.00,
            savingsFrequency: 'Daily',
            merchantId: 1,
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer',
              example: 801,
              description: 'Package ID'
            },
            name: { 
              type: 'string',
              example: 'Premium Savings Package',
              description: 'Package name'
            },
            type: { 
              type: 'string', 
              enum: ['Investment', 'Savings', 'Loan'],
              example: 'Savings',
              description: 'Package type'
            },
            amount: { 
              type: 'number', 
              format: 'float',
              example: 100000.00,
              description: 'Package amount'
            },
            seedAmount: { 
              type: 'number', 
              format: 'float',
              example: 10000.00,
              description: 'Initial seed amount'
            },
            seedType: { 
              type: 'string',
              example: 'Fixed',
              description: 'Seed amount type'
            },
            period: { 
              type: 'integer',
              example: 30,
              description: 'Collection period in days'
            },
            collectionDays: { 
              type: 'string',
              example: 'Daily',
              description: 'Collection frequency'
            },
            duration: { 
              type: 'integer',
              example: 365,
              description: 'Package duration in days'
            },
            benefits: { 
              type: 'array', 
              items: { type: 'string' },
              example: ['High interest rate', 'Flexible withdrawal', 'Bonus rewards'],
              description: 'Package benefits'
            },
            description: { 
              type: 'string',
              example: 'Premium savings package with high returns',
              description: 'Package description'
            },
            status: { 
              type: 'string', 
              enum: ['Active', 'Inactive'],
              example: 'Active',
              description: 'Package status'
            },
            interestRate: { 
              type: 'number', 
              format: 'float',
              example: 12.5,
              description: 'Interest rate percentage'
            },
            extraCharges: { 
              type: 'number', 
              format: 'float',
              example: 500.00,
              description: 'Extra charges'
            },
            defaultPenalty: { 
              type: 'number', 
              format: 'float',
              example: 1000.00,
              description: 'Default penalty amount'
            },
            defaultDays: { 
              type: 'integer',
              example: 7,
              description: 'Default grace period in days'
            },
            loanAmount: { 
              type: 'number', 
              format: 'float',
              example: 500000.00,
              description: 'Maximum loan amount'
            },
            loanInterestRate: { 
              type: 'number', 
              format: 'float',
              example: 15.0,
              description: 'Loan interest rate percentage'
            },
            loanPeriod: { 
              type: 'integer',
              example: 12,
              description: 'Loan period in months'
            },
            defaultAmount: { 
              type: 'number', 
              format: 'float',
              example: 5000.00,
              description: 'Default amount'
            },
            gracePeriod: { 
              type: 'integer',
              example: 30,
              description: 'Grace period in days'
            },
            loanCharges: { 
              type: 'number', 
              format: 'float',
              example: 2500.00,
              description: 'Loan processing charges'
            },
            packageCategory: { 
              type: 'string',
              example: 'Premium',
              description: 'Package category'
            },
            maxCustomers: { 
              type: 'integer',
              example: 100,
              description: 'Maximum number of customers for this package'
            },
            currentCustomers: { 
              type: 'integer',
              example: 25,
              description: 'Current number of customers enrolled'
            },
            minimumSavings: { 
              type: 'number',
              format: 'float',
              example: 1000.00,
              description: 'Minimum savings amount required'
            },
            savingsFrequency: { 
              type: 'string',
              example: 'Daily',
              description: 'Savings collection frequency'
            },
            merchantId: { 
              type: 'integer',
              example: 1,
              description: 'Associated merchant ID'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Package creation date'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Package last update date'
            }
          }
        },
        PackageCreateRequest: {
          type: 'object',
          required: ['name', 'type', 'amount'],
          properties: {
            name: {
              type: 'string',
              example: 'Premium Savings Package',
              description: 'Package name'
            },
            type: {
              type: 'string',
              enum: ['Investment', 'Savings', 'Loan'],
              example: 'Savings',
              description: 'Package type'
            },
            amount: {
              type: 'number',
              format: 'float',
              example: 100000.00,
              description: 'Package amount'
            },
            seedAmount: {
              type: 'number',
              format: 'float',
              example: 10000.00,
              description: 'Initial seed amount'
            },
            seedType: {
              type: 'string',
              example: 'Fixed',
              description: 'Seed amount type'
            },
            period: {
              type: 'integer',
              example: 30,
              description: 'Collection period in days'
            },
            collectionDays: {
              type: 'string',
              example: 'Daily',
              description: 'Collection frequency'
            },
            duration: {
              type: 'integer',
              example: 365,
              description: 'Package duration in days'
            },
            benefits: {
              type: 'array',
              items: { type: 'string' },
              example: ['High interest rate', 'Flexible withdrawal', 'Bonus rewards'],
              description: 'Package benefits'
            },
            description: {
              type: 'string',
              example: 'Premium savings package with high returns',
              description: 'Package description'
            },
            interestRate: {
              type: 'number',
              format: 'float',
              example: 12.5,
              description: 'Interest rate percentage'
            },
            extraCharges: {
              type: 'number',
              format: 'float',
              example: 500.00,
              description: 'Extra charges'
            },
            defaultPenalty: {
              type: 'number',
              format: 'float',
              example: 1000.00,
              description: 'Default penalty amount'
            },
            defaultDays: {
              type: 'integer',
              example: 7,
              description: 'Default grace period in days'
            },
            loanAmount: {
              type: 'number',
              format: 'float',
              example: 500000.00,
              description: 'Maximum loan amount'
            },
            loanInterestRate: {
              type: 'number',
              format: 'float',
              example: 15.0,
              description: 'Loan interest rate percentage'
            },
            loanPeriod: {
              type: 'integer',
              example: 12,
              description: 'Loan period in months'
            },
            defaultAmount: {
              type: 'number',
              format: 'float',
              example: 5000.00,
              description: 'Default amount'
            },
            gracePeriod: {
              type: 'integer',
              example: 30,
              description: 'Grace period in days'
            },
            loanCharges: {
              type: 'number',
              format: 'float',
              example: 2500.00,
              description: 'Loan processing charges'
            },
            packageCategory: {
              type: 'string',
              example: 'Premium',
              description: 'Package category'
            }
          }
        },

        // Investment Application Schema
        InvestmentApplication: {
          type: 'object',
          required: ['customerName', 'targetAmount', 'duration'],
          example: {
            id: 901,
            customerName: 'John Doe',
            accountNumber: 'ACC123456',
            targetAmount: 200000.00,
            duration: 365,
            agentId: 3,
            agentName: 'Agent Smith',
            branch: 'Main Branch',
            status: 'Pending',
            notes: 'Long-term investment for retirement planning',
            rejectionReason: 'Insufficient documentation',
            dateApplied: '2024-01-15T10:30:00.000Z',
            merchantId: 1,
            packageId: 801,
            approvedBy: 2,
            approvedAt: '2024-01-15T14:30:00.000Z',
            createdAt: '2024-01-15T10:30:00.000Z',
            updatedAt: '2024-01-15T10:30:00.000Z'
          },
          properties: {
            id: { 
              type: 'integer', 
              description: 'Application ID',
              example: 901
            },
            customerName: { 
              type: 'string', 
              description: 'Customer full name',
              example: 'John Doe'
            },
            accountNumber: { 
              type: 'string', 
              description: 'Customer account number',
              example: 'ACC123456'
            },
            targetAmount: { 
              type: 'number', 
              format: 'float', 
              description: 'Target investment amount',
              example: 200000.00
            },
            duration: { 
              type: 'integer', 
              description: 'Investment duration in days',
              example: 365
            },
            agentId: { 
              type: 'integer', 
              description: 'Agent ID handling the application',
              example: 3
            },
            agentName: { 
              type: 'string', 
              description: 'Agent name',
              example: 'Agent Smith'
            },
            branch: { 
              type: 'string', 
              description: 'Branch name',
              example: 'Main Branch'
            },
            status: { 
              type: 'string', 
              enum: ['Pending', 'Approved', 'Rejected', 'Completed'], 
              description: 'Application status',
              example: 'Pending'
            },
            notes: { 
              type: 'string', 
              description: 'Additional notes',
              example: 'Long-term investment for retirement planning'
            },
            rejectionReason: { 
              type: 'string', 
              description: 'Reason for rejection',
              example: 'Insufficient documentation'
            },
            dateApplied: { 
              type: 'string', 
              format: 'date-time', 
              description: 'Date when application was submitted',
              example: '2024-01-15T10:30:00.000Z'
            },
            merchantId: { 
              type: 'integer', 
              description: 'Merchant ID',
              example: 1
            },
            packageId: { 
              type: 'integer', 
              description: 'Selected package ID',
              example: 801
            },
            approvedBy: { 
              type: 'integer',
              example: 2,
              description: 'User ID who approved/rejected the application'
            },
            approvedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T14:30:00.000Z',
              description: 'Application approval/rejection date'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Application creation date'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time',
              example: '2024-01-15T10:30:00.000Z',
              description: 'Application last update date'
            }
          }
        },
        InvestmentApplicationCreateRequest: {
          type: 'object',
          required: ['customerName', 'targetAmount', 'duration'],
          properties: {
            customerName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer full name'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            targetAmount: {
              type: 'number',
              format: 'float',
              example: 200000.00,
              description: 'Target investment amount'
            },
            duration: {
              type: 'integer',
              example: 365,
              description: 'Investment duration in days'
            },
            packageId: {
              type: 'integer',
              example: 801,
              description: 'Selected package ID'
            },
            notes: {
              type: 'string',
              example: 'Long-term investment for retirement planning',
              description: 'Additional notes'
            }
          }
        },

        // Customer Schema
        Customer: {
          type: 'object',
          required: ['fullName', 'phoneNumber', 'email', 'agentId', 'branchId', 'merchantId'],
          properties: {
            id: { 
              type: 'integer', 
              description: 'Customer ID',
              example: 12
            },
            name: { 
              type: 'string', 
              description: 'Customer short name',
              example: 'John'
            },
            fullName: { 
              type: 'string', 
              description: 'Customer full name', 
              example: 'John Doe' 
            },
            phoneNumber: { 
              type: 'string', 
              description: 'Customer phone number', 
              example: '+2348012345678' 
            },
            email: { 
              type: 'string', 
              format: 'email', 
              description: 'Customer email address', 
              example: 'john.doe@example.com' 
            },
            accountNumber: { 
              type: 'string', 
              description: 'Customer account number', 
              example: 'ACC123456' 
            },
            alias: { 
              type: 'string', 
              description: 'Customer alias or nickname', 
              example: 'Johnny' 
            },
            address: { 
              type: 'string', 
              description: 'Customer address', 
              example: '123 Main Street, Lagos, Nigeria' 
            },
            agentId: { 
              type: 'integer', 
              description: 'Agent ID assigned to customer',
              example: 3
            },
            branchId: { 
              type: 'integer', 
              description: 'Branch ID where customer is registered',
              example: 2
            },
            merchantId: { 
              type: 'integer', 
              description: 'Merchant ID',
              example: 1
            },
            packageId: { 
              type: 'integer', 
              description: 'Package ID assigned to customer',
              example: 801
            },
            status: { 
              type: 'string', 
              enum: ['Active', 'Inactive', 'Suspended'],
              description: 'Customer status',
              example: 'Active'
            },
            dateOfBirth: {
              type: 'string',
              format: 'date',
              description: 'Customer date of birth',
              nullable: true,
              example: '1990-05-15'
            },
            gender: {
              type: 'string',
              enum: ['Male', 'Female', 'Other'],
              description: 'Customer gender',
              nullable: true,
              example: 'Male'
            },
            occupation: {
              type: 'string',
              description: 'Customer occupation',
              nullable: true,
              example: 'Software Engineer'
            },
            createdAt: { 
              type: 'string', 
              format: 'date-time', 
              description: 'Customer creation date',
              example: '2024-01-15T10:30:00.000Z'
            },
            updatedAt: { 
              type: 'string', 
              format: 'date-time', 
              description: 'Customer last update date',
              example: '2024-01-15T10:30:00.000Z'
            },
            // Populated fields in responses
            agentName: { 
              type: 'string', 
              description: 'Agent name (populated in responses)', 
              example: 'Agent Smith' 
            },
            branchName: { 
              type: 'string', 
              description: 'Branch name (populated in responses)', 
              example: 'Main Branch' 
            },
            packageName: { 
              type: 'string', 
              description: 'Package name (populated in responses)', 
              example: 'Premium Package' 
            }
          }
        },
        CustomerCreateRequest: {
          type: 'object',
          required: ['fullName', 'phoneNumber', 'email', 'agentId', 'branchId'],
          properties: {
            fullName: {
              type: 'string',
              example: 'John Doe',
              description: 'Customer full name'
            },
            phoneNumber: {
              type: 'string',
              example: '+2348012345678',
              description: 'Customer phone number'
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'john.doe@example.com',
              description: 'Customer email address'
            },
            accountNumber: {
              type: 'string',
              example: 'ACC123456',
              description: 'Customer account number'
            },
            alias: {
              type: 'string',
              example: 'Johnny',
              description: 'Customer alias or nickname'
            },
            address: {
              type: 'string',
              example: '123 Main Street, Lagos, Nigeria',
              description: 'Customer address'
            },
            agentId: {
              type: 'integer',
              example: 3,
              description: 'Agent ID assigned to customer'
            },
            branchId: {
              type: 'integer',
              example: 2,
              description: 'Branch ID where customer is registered'
            },
            packageId: {
              type: 'integer',
              example: 801,
              description: 'Package ID assigned to customer'
            },
            dateOfBirth: {
              type: 'string',
              format: 'date',
              example: '1990-05-15',
              description: 'Customer date of birth'
            },
            gender: {
              type: 'string',
              enum: ['Male', 'Female', 'Other'],
              example: 'Male',
              description: 'Customer gender'
            },
            occupation: {
              type: 'string',
              example: 'Software Engineer',
              description: 'Customer occupation'
            }
          }
        },

        // Pagination Schema
        Pagination: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              description: 'Current page number',
              minimum: 1,
              example: 1
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page',
              minimum: 1,
              maximum: 100,
              example: 10
            },
            total: {
              type: 'integer',
              description: 'Total number of items',
              example: 150
            },
            pages: {
              type: 'integer',
              description: 'Total number of pages',
              example: 15
            },
            hasNext: {
              type: 'boolean',
              description: 'Whether there is a next page',
              example: true
            },
            hasPrev: {
              type: 'boolean',
              description: 'Whether there is a previous page',
              example: false
            }
          }
        }
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Page number',
          required: false,
          schema: {
            type: 'integer',
            default: 1,
            minimum: 1
          }
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Number of items per page',
          required: false,
          schema: {
            type: 'integer',
            default: 10,
            minimum: 1,
            maximum: 100
          }
        },
        SortParam: {
          name: 'sort',
          in: 'query',
          description: 'Sort field',
          required: false,
          schema: {
            type: 'string'
          }
        },
        OrderParam: {
          name: 'order',
          in: 'query',
          description: 'Sort order (asc or desc)',
          required: false,
          schema: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: 'desc'
          }
        },
        SearchParam: {
          name: 'search',
          in: 'query',
          description: 'Search term',
          required: false,
          schema: {
            type: 'string'
          }
        },
        StatusParam: {
          name: 'status',
          in: 'query',
          description: 'Filter by status',
          required: false,
          schema: {
            type: 'string'
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                message: 'Invalid or expired token',
                error: 'Token verification failed'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                message: 'Access forbidden',
                error: 'Insufficient permissions'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                message: 'Resource not found',
                error: 'The requested resource was not found'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              },
              example: {
                success: false,
                message: 'Validation failed',
                error: 'Email must be a valid email address'
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: [controllersGlob]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Swagger UI setup with enhanced options
const swaggerUiOptions = {
  explorer: true,
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #1a365d; }
    .swagger-ui .btn.authorize { background-color: #3182ce; border-color: #3182ce; }
    .swagger-ui .btn.authorize:hover { background-color: #2c5aa0; }
  `,
  customSiteTitle: 'AlphaWeb API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
    authAction: {
      bearerAuth: {
        name: 'bearerAuth',
        schema: {
          type: 'http',
          in: 'header',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        value: ''
      }
    }
  }
};

module.exports = { 
  swaggerUi, 
  swaggerSpec, 
  swaggerUiOptions 
};
