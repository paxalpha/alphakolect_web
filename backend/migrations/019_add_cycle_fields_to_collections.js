'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Only proceed if collections table exists
    const [{ exists: collectionsExists }] = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.collections') IS NOT NULL as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!collectionsExists) {
      console.log('Skipping 019_add_cycle_fields_to_collections.js: collections table does not exist');
      return;
    }

    // cycle
    const [{ exists: hasCycle }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='cycle') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasCycle) {
      await queryInterface.addColumn('collections', 'cycle', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 31,
        comment: 'Total cycle days (always 31)'
      });
    }

    // cycle_counter
    const [{ exists: hasCycleCounter }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='cycle_counter') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasCycleCounter) {
      await queryInterface.addColumn('collections', 'cycle_counter', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Current day in cycle (1-31)'
      });
    }

    // package_id (FK only if packages exists)
    const [{ exists: hasPackageId }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='package_id') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasPackageId) {
      const [{ exists: packagesExists }] = await queryInterface.sequelize.query(
        "SELECT to_regclass('public.packages') IS NOT NULL as exists;",
        { type: Sequelize.QueryTypes.SELECT }
      );
      if (packagesExists) {
        await queryInterface.addColumn('collections', 'package_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'packages', key: 'id' },
          comment: 'Reference to collection package'
        });
      } else {
        await queryInterface.addColumn('collections', 'package_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Reference to collection package (no FK, packages table missing at migration time)'
        });
      }
    }

    // package_name
    const [{ exists: hasPackageName }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='package_name') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasPackageName) {
      await queryInterface.addColumn('collections', 'package_name', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Collection package name'
      });
    }

    // package_amount
    const [{ exists: hasPackageAmount }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='package_amount') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasPackageAmount) {
      await queryInterface.addColumn('collections', 'package_amount', {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        comment: 'Package amount for autofill'
      });
    }

    // is_first_collection
    const [{ exists: hasIsFirst }] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='is_first_collection') as exists;",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!hasIsFirst) {
      await queryInterface.addColumn('collections', 'is_first_collection', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Whether this is the first collection of the 31-day cycle'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('collections', 'cycle');
    await queryInterface.removeColumn('collections', 'cycle_counter');
    await queryInterface.removeColumn('collections', 'package_id');
    await queryInterface.removeColumn('collections', 'package_name');
    await queryInterface.removeColumn('collections', 'package_amount');
    await queryInterface.removeColumn('collections', 'is_first_collection');
  }
};
