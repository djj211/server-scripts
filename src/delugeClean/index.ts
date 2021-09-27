import DelugeRPC from 'deluge-rpc';

import * as config from './config.json';

interface Torrent {
  queue: number;
  completed_time: number;
  time_added: number;
  ratio: number;
  name: string;
  state: string;
}

interface TorrentToQueue extends Torrent {
  id: string;
}

interface ConfigOptions {
  DELUGE_WEB_URL: string;
  DELUGE_WEB_PASSWORD: string;
  MAX_COMPLETED_AGE?: number;
  MAX_DATE_ADDED_AGE?: number;
  MAX_COMPLETED_SHARE_RATIO?: number;
}

const getConfig = () => {
  return config as ConfigOptions;
};

const getDate = (inputDate?: number) => {
  if (inputDate && inputDate > 0) {
    const dateToReturn = new Date();
    dateToReturn.setDate(dateToReturn.getDate() - inputDate);
    return dateToReturn;
  }

  return;
};

const run = async () => {
  try {
    const conf = getConfig();

    const delCompletedDate = getDate(conf.MAX_COMPLETED_AGE);
    const delRegardlessDate = getDate(conf.MAX_DATE_ADDED_AGE);
    const maxRatio = conf.MAX_COMPLETED_SHARE_RATIO;

    const deluge = new DelugeRPC(conf.DELUGE_WEB_URL, conf.DELUGE_WEB_PASSWORD);

    // Authenticate to deluge (set cookie)
    await deluge.auth();

    const isConnected = await deluge.call('web.connected');

    if (!isConnected)
      // connect to the first host
      await deluge.connect(0);

    const torrents = await deluge.call('core.get_torrents_status', [
      {},
      // list of fields to return
      ['queue', 'name', 'ratio', 'time_added', 'completed_time', 'state'],
    ]);

    const torsToDelete: string[] = [];
    const torrentsToQueueBottom: TorrentToQueue[] = [];

    Object.keys(torrents).forEach((key) => {
      const torrent: Torrent = torrents[key];
      const completed = torrent.state === 'Seeding';
      const completedTime = !!torrent.completed_time ? torrent.completed_time * 1000 : 0;
      const addedTime = torrent.time_added * 1000;

      if (!delRegardlessDate && completed) {
        // Delete completed if delete completed date is not set.
        torsToDelete.push(key);
      } else if (delCompletedDate && completed && completedTime < delCompletedDate.getTime()) {
        // Delete if completed is set and deletion date has past.
        torsToDelete.push(key);
      } else if (!!maxRatio && completed && torrent.ratio >= maxRatio) {
        // Delete if completed and max seed ratio has past.
        torsToDelete.push(key);
      } else if (delRegardlessDate && addedTime < delRegardlessDate.getTime()) {
        // Delete if the delete regardless date is set and the date added has past that date
        torsToDelete.push(key);
      } else if (delCompletedDate && !completed && addedTime < delCompletedDate.getTime()) {
        // Queue torrent to bottom if the torrent has existing longer than the completion date.
        // We aren't ready to give up on this torrent. But it shouldn't be high priority anymore.
        torrentsToQueueBottom.push({
          ...torrent,
          id: key,
        });
      }
    });

    if (torsToDelete.length) {
      console.log(`Removing ${torsToDelete.length} torrents`);
      await deluge.call('core.remove_torrents', [torsToDelete, false]);
    } else {
      console.log('There are not any torrents to delete');
    }

    if (torrentsToQueueBottom.length) {
      console.log(`There are ${torrentsToQueueBottom.length} long running torrents to move to the bottom of the queue`);
      const sortedTorrents = torrentsToQueueBottom.sort(({ queue: a }, { queue: b }) => b - a);

      const queueBottomPromises = sortedTorrents.map((torrent) => {
        deluge.call('core.queue_bottom', [[torrent.id]]);
      });

      await Promise.allSettled(queueBottomPromises);
    }
  } catch (ex) {
    console.log(ex);
  }
};

run();
