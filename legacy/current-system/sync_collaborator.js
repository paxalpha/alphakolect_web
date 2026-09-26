const { Collaborator } = require('./models');

async function syncCollaborator() {
    try {
        console.log('Syncing Collaborator model...');
        await Collaborator.sync({ force: false }); // force: false will only create if not exists
        console.log('Collaborator table synced successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error syncing Collaborator table:', error);
        process.exit(1);
    }
}

syncCollaborator();
