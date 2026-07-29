"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
/**
 * Seeds two municipalities so tenant isolation is testable from the first run:
 * if a query ever leaks, the second tenant's data makes it obvious immediately.
 */
async function main() {
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password || password.length < 10) {
        throw new Error('Set SEED_ADMIN_PASSWORD (10+ characters) before seeding');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const tenants = [
        {
            slug: 'al-bazourieh',
            name: 'Al Bazourieh Municipality',
            nameAr: 'بلدية البازورية',
            adminPathSegment: 'admin-portal-x7b2',
            config: {
                primaryColor: '#1F5C4B',
                enabledPropertyTypes: ['BUILDING', 'HOUSE', 'LAND', 'TENT'],
                contactPhone: '+9617000000',
            },
        },
        {
            slug: 'deir-qanoun',
            name: 'Deir Qanoun Municipality',
            nameAr: 'بلدية دير قانون',
            adminPathSegment: 'admin-portal-q4m9',
            config: {
                primaryColor: '#7A3E2C',
                // This municipality does not accept tent registrations, which exercises
                // the per-tenant property-type gate.
                enabledPropertyTypes: ['BUILDING', 'HOUSE', 'LAND'],
                contactPhone: '+9617111111',
            },
        },
    ];
    for (const tenant of tenants) {
        const created = await prisma.tenant.upsert({
            where: { slug: tenant.slug },
            update: { name: tenant.name, nameAr: tenant.nameAr, config: tenant.config },
            create: tenant,
        });
        const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.gov.lb').toLowerCase();
        await prisma.municipalityUser.upsert({
            where: { tenantId_email: { tenantId: created.id, email } },
            update: {},
            create: {
                tenantId: created.id,
                email,
                fullName: 'Municipality Administrator',
                passwordHash,
                role: 'SUPER_ADMIN',
            },
        });
        console.log(`Seeded ${tenant.nameAr}  ->  /${tenant.slug}  (admin path: ${tenant.adminPathSegment})`);
    }
    console.log('\nSign in with the seeded email and the SEED_ADMIN_PASSWORD you set.');
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map